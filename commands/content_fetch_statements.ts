import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import contentConfig from '#config/content'
import { extractProblem, FETCHABLE, type Judge } from '#services/statement_extractors'

const DELAY_MS = 1500
const USER_AGENT = 'cp-trainer statement fetcher (private study tool)'
/** Judges behind a bot check: their pages are collected in your browser. */
const BROWSER: Record<string, string> = { Codeforces: 'codeforces.com', SPOJ: 'www.spoj.com' }

interface Entry {
  path: string
  data: Record<string, any>
}

/**
 * Fills problems' `summary` in the content repo checkout with the original
 * statement (D-061, D-062). Writes the JSON files; review and open a PR.
 *
 *   node ace content:fetch-statements                 CSES / AtCoder / Kattis problems with an empty summary
 *   node ace content:fetch-statements --force         also overwrite filled summaries
 *   node ace content:fetch-statements --only=cses-1158,atcoder-dp-a
 *   node ace content:fetch-statements --snippet       write tmp/statements-snippet.js for Codeforces / SPOJ
 *   node ace content:fetch-statements --from=~/Downloads/codeforces-statements.json
 *
 * Codeforces and SPOJ: paste the snippet into the browser console on
 * codeforces.com (and on spoj.com). It downloads a JSON file of the pages your
 * browser can see; `--from` imports it.
 */
export default class ContentFetchStatements extends BaseCommand {
  static commandName = 'content:fetch-statements'
  static description = 'Copy problem statements from the judges into the content repo files'
  static options: CommandOptions = {}

  @flags.boolean({ description: 'Overwrite summaries that are already filled' })
  declare force: boolean

  @flags.string({ description: 'Only these problem ids, comma-separated' })
  declare only?: string

  @flags.boolean({ description: 'Write the browser snippet for Codeforces / SPOJ' })
  declare snippet: boolean

  @flags.string({ description: 'Import a JSON file downloaded by the snippet' })
  declare from?: string

  async run() {
    if (this.snippet) return this.writeSnippet()
    if (this.from)
      return this.importCaptured(resolve(this.from.replace(/^~/, process.env.HOME ?? '~')))
    return this.fetchDirect()
  }

  protected problems(): Entry[] {
    const root = join(contentConfig.dir, 'problems')
    const entries: Entry[] = []
    for (const subject of readdirSync(root)) {
      for (const file of readdirSync(join(root, subject))) {
        if (!file.endsWith('.json')) continue
        const path = join(root, subject, file)
        entries.push({ path, data: JSON.parse(readFileSync(path, 'utf8')) })
      }
    }
    return entries.sort((a, b) => a.data.id.localeCompare(b.data.id))
  }

  protected wanted(entry: Entry) {
    const only = this.only?.split(',').map((id) => id.trim())
    if (only) return only.includes(entry.data.id)
    return this.force || !entry.data.summary
  }

  protected save(entry: Entry, summary: string) {
    entry.data.summary = summary
    writeFileSync(entry.path, `${JSON.stringify(entry.data, null, 2)}\n`)
  }

  protected async fetchDirect() {
    const all = this.problems()
    const todo = all.filter((e) => FETCHABLE.includes(e.data.source) && this.wanted(e))
    const browser = all.filter((e) => e.data.source in BROWSER && this.wanted(e)).length
    this.logger.info(`${todo.length} problems to fetch from CSES / AtCoder / Kattis`)
    let failed = 0
    for (const [i, entry] of todo.entries()) {
      const { id, source, url } = entry.data
      try {
        const page = source === 'AtCoder' ? `${url}?lang=en` : url
        const response = await fetch(page, { headers: { 'user-agent': USER_AGENT } })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const { statement } = extractProblem(source as Judge, await response.text())
        if (statement.length < 20) throw new Error('statement came out empty')
        this.save(entry, statement)
        this.logger.info(`[${i + 1}/${todo.length}] ${id}: ${statement.length} chars`)
      } catch (error) {
        failed++
        this.logger.error(`[${i + 1}/${todo.length}] ${id}: ${(error as Error).message}`)
      }
      if (i < todo.length - 1) await new Promise((r) => setTimeout(r, DELAY_MS))
    }
    this.logger.success(`${todo.length - failed} filled, ${failed} failed`)
    if (browser) {
      this.logger.info(`${browser} Codeforces / SPOJ problems need the browser: --snippet`)
    }
    if (failed) this.exitCode = 1
  }

  protected writeSnippet() {
    const pages: Record<string, Record<string, string>> = {}
    for (const entry of this.problems()) {
      const host = BROWSER[entry.data.source]
      if (!host || !this.wanted(entry)) continue
      pages[host] ??= {}
      pages[host][entry.data.id] = new URL(entry.data.url).pathname
    }
    const snippet = `// Paste into the browser console on ${Object.keys(pages).join(' and on ')}.
// It opens each problem page of that site (one every ${DELAY_MS / 1000}s) and downloads a JSON
// file with the statements. Then: node ace content:fetch-statements --from=<that file>
(async () => {
  const pages = ${JSON.stringify(pages, null, 2)}
  const mine = pages[location.host]
  if (!mine) return console.error('Run this on: ' + Object.keys(pages).join(', '))
  const selector = location.host.includes('codeforces') ? '.problem-statement' : '#problem-body'
  const out = {}
  for (const [id, path] of Object.entries(mine)) {
    const html = await (await fetch(path, { credentials: 'include' })).text()
    const node = new DOMParser().parseFromString(html, 'text/html').querySelector(selector)
    out[id] = node ? node.outerHTML : null
    console.log(id, node ? 'ok' : 'NOT FOUND')
    await new Promise((resolve) => setTimeout(resolve, ${DELAY_MS}))
  }
  const name = location.host.replace(/^www\\./, '').split('.')[0] + '-statements.json'
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }))
  link.download = name
  link.click()
  console.log('Saved ' + name)
})()
`
    const file = this.app.tmpPath('statements-snippet.js')
    writeFileSync(file, snippet)
    const count = Object.values(pages).reduce((n, p) => n + Object.keys(p).length, 0)
    this.logger.success(
      `wrote ${file} (${count} problems on ${Object.keys(pages).join(', ') || 'no site'})`
    )
  }

  protected importCaptured(file: string) {
    const captured: Record<string, string | null> = JSON.parse(readFileSync(file, 'utf8'))
    const byId = new Map(this.problems().map((e) => [e.data.id, e]))
    let filled = 0
    for (const [id, html] of Object.entries(captured)) {
      const entry = byId.get(id)
      if (!entry) {
        this.logger.error(`${id}: not a problem in the content repo`)
        continue
      }
      if (!this.wanted(entry)) {
        this.logger.info(`${id}: already has a summary (use --force to overwrite)`)
        continue
      }
      try {
        if (!html) throw new Error('the page had no statement')
        const { statement } = extractProblem(entry.data.source as Judge, html)
        if (statement.length < 20) throw new Error('statement came out empty')
        this.save(entry, statement)
        filled++
        this.logger.info(`${id}: ${statement.length} chars`)
      } catch (error) {
        this.logger.error(`${id}: ${(error as Error).message}`)
      }
    }
    this.logger.success(`${filled} filled from ${file}`)
  }
}
