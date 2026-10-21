import { inject } from '@adonisjs/core'
import Problem from '#models/problem'
import ProblemDraft from '#services/problem_draft'
import { extractProblem, FETCHABLE, type Judge } from '#services/statement_extractors'
import type { ProblemFile } from '#types/content'

export interface ParsedProblemUrl {
  judge: Judge
  /** The bank's id convention: cses-1158, atcoder-dp-e, kattis-polygonarea, cf-166b, spoj-pon. */
  id: string
  /** The canonical problem URL. */
  url: string
}

export type ImportResult =
  | { kind: 'invalid' }
  | { kind: 'existing'; id: string }
  /** Codeforces / SPOJ ("blocked"), or a fetch that failed: the manual form, partly filled. */
  | { kind: 'manual'; reason: 'blocked' | 'failed'; draft: ProblemFile }
  | { kind: 'fetched'; draft: ProblemFile }

const HOSTS: Record<string, Judge> = {
  'cses.fi': 'CSES',
  'atcoder.jp': 'AtCoder',
  'open.kattis.com': 'Kattis',
  'codeforces.com': 'Codeforces',
  'www.codeforces.com': 'Codeforces',
  'spoj.com': 'SPOJ',
  'www.spoj.com': 'SPOJ',
}

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Recognizes a problem URL on one of the supported judges. Anything else is
 * null, and the server never fetches it.
 */
export function parseProblemUrl(raw: string): ParsedProblemUrl | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const judge = HOSTS[url.host.toLowerCase()]
  const path = url.pathname

  let parsed: ParsedProblemUrl | null = null
  if (judge === 'CSES') {
    const m = path.match(/^\/problemset\/(?:task|view|stats|result)\/(\d+)\/?$/)
    if (m) parsed = { judge, id: `cses-${m[1]}`, url: `https://cses.fi/problemset/task/${m[1]}` }
  } else if (judge === 'AtCoder') {
    const m = path.match(/^\/contests\/([\w-]+)\/tasks\/([\w-]+)\/?$/)
    if (m) {
      const id = `atcoder-${m[2].toLowerCase().replace(/_/g, '-')}`
      parsed = { judge, id, url: `https://atcoder.jp/contests/${m[1]}/tasks/${m[2]}` }
    }
  } else if (judge === 'Kattis') {
    const m = path.match(/^\/problems\/([a-z0-9]+)\/?$/)
    if (m) {
      parsed = { judge, id: `kattis-${m[1]}`, url: `https://open.kattis.com/problems/${m[1]}` }
    }
  } else if (judge === 'Codeforces') {
    const m = path.match(/^\/(problemset\/problem|contest)\/(\d+)\/(?:problem\/)?([A-Za-z]\d?)\/?$/)
    if (m) {
      const [, kind, contest, index] = m
      const canonical =
        kind === 'contest'
          ? `https://codeforces.com/contest/${contest}/problem/${index.toUpperCase()}`
          : `https://codeforces.com/problemset/problem/${contest}/${index.toUpperCase()}`
      parsed = { judge, id: `cf-${contest}${index.toLowerCase()}`, url: canonical }
    }
  } else if (judge === 'SPOJ') {
    const m = path.match(/^\/problems\/([A-Za-z0-9_]+)\/?$/)
    if (m) {
      const code = m[1].toUpperCase()
      parsed = {
        judge,
        id: `spoj-${code.toLowerCase()}`,
        url: `https://www.spoj.com/problems/${code}/`,
      }
    }
  }
  return parsed && ID.test(parsed.id) ? parsed : null
}

/**
 * /contribute "From a link": a problem URL → a prefilled form (D-068). The
 * draft is only rendered, never stored; it still reaches the content repo
 * through a GitHub PR.
 */
@inject()
export default class StatementImport {
  constructor(protected drafts: ProblemDraft) {}

  /** The page fetch; tests replace it. */
  fetchHtml = async (url: string) => {
    const response = await fetch(url, {
      headers: { 'user-agent': 'cp-trainer contribute importer (private study tool)' },
      signal: AbortSignal.timeout(10_000),
    })
    // Redirects are followed; never end up somewhere that isn't a judge.
    if (!HOSTS[new URL(response.url).host]) throw new Error('redirected away from the judge')
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.text()
  }

  async import(raw: string): Promise<ImportResult> {
    const parsed = parseProblemUrl(raw)
    if (!parsed) return { kind: 'invalid' }
    if (await Problem.find(parsed.id)) return { kind: 'existing', id: parsed.id }

    const draft: ProblemFile = {
      ...this.drafts.blank(),
      id: parsed.id,
      source: parsed.judge,
      url: parsed.url,
    }
    if (!FETCHABLE.includes(parsed.judge)) return { kind: 'manual', reason: 'blocked', draft }

    try {
      // AtCoder serves both languages; ask for English.
      const page = parsed.judge === 'AtCoder' ? `${parsed.url}?lang=en` : parsed.url
      const extracted = extractProblem(parsed.judge, await this.fetchHtml(page))
      if (extracted.statement.length < 20) throw new Error('no statement on the page')
      return {
        kind: 'fetched',
        draft: {
          ...draft,
          title: extracted.title ?? '',
          summary: extracted.statement,
          constraints: {
            text: extracted.constraints ?? '',
            verified: Boolean(extracted.constraints),
          },
          difficulty: extracted.difficulty ?? draft.difficulty,
        },
      }
    } catch {
      return { kind: 'manual', reason: 'failed', draft }
    }
  }
}
