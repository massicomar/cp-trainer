import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inject } from '@adonisjs/core'
import contentConfig from '#config/content'
import Problem from '#models/problem'
import Catalog from '#services/catalog'
import ContentLoader from '#services/content_loader'
import { hostAllowed, leakedWords } from '#services/content_rules'
import type { ProblemFile } from '#types/content'

export interface DraftCheck {
  /** Things content CI would reject. */
  errors: string[]
  /** Fine for CI, but worth a look. */
  warnings: string[]
}

export interface DraftPreview {
  json: string
  /** Where the file goes in the content repo; null until there's an id and an intended subject. */
  path: string | null
  check: DraftCheck
  /** False while the form is still empty, so the page doesn't open with a wall of errors. */
  started: boolean
  downloadName: string
  downloadHref: string
  github: { url: string; prefilled: boolean } | null
}

export interface SchemaChoices {
  sources: string[]
  scales: string[]
  tiers: string[]
  kinds: string[]
}

/** Authored option ids, in order. The schema allows 2–6 options per layer. */
const OPTION_IDS = 'abcdef'
/** GitHub refuses very long URLs; past this, only Copy / Download are offered. */
const MAX_GITHUB_URL = 8000

/**
 * The contribute page's logic: form fields → a problem file in the content
 * repo's format, checked the way content CI checks it. Nothing is stored.
 */
@inject()
export default class ProblemDraft {
  constructor(
    protected loader: ContentLoader,
    protected catalog: Catalog
  ) {}

  /**
   * A new problem, matching templates/problem.template.json's defaults.
   */
  blank(): ProblemFile {
    return {
      schemaVersion: 1,
      id: '',
      status: 'draft',
      author: '',
      collection: 'community',
      title: '',
      source: 'CSES',
      url: '',
      difficulty: { tier: 'medium', scale: 'estimate', value: 'M' },
      summary: '',
      constraints: { text: '', verified: false },
      answers: {
        subjects: [{ id: '', role: 'intended' }],
        techniques: [{ id: '', role: 'intended' }],
      },
      distractors: [],
      explanation: '',
      traps: [],
      pairWith: [],
      extraLayers: [],
      deprecated: false,
    }
  }

  /**
   * Builds the file from the form, in the same key order as the template and
   * the existing files. Empty rows are dropped; layer options get ids a, b, c…
   * in the order they're listed.
   */
  fromForm(input: Record<string, any>): ProblemFile {
    const answers = (value: unknown) =>
      rows(value)
        .map((row) => ({ id: text(row?.id), role: text(row?.role) || 'accepted' }))
        .filter((row) => row.id) as ProblemFile['answers']['subjects']

    const extraLayers = rows(input.layers)
      .map((layer) => {
        const options = rows(layer?.options)
          .map((option) => ({
            text: text(option?.text),
            why: text(option?.why),
            correct: isOn(option?.correct),
          }))
          .filter((option) => option.text)
        return {
          key: text(layer?.key),
          kind: text(layer?.kind) || 'custom',
          prompt: text(layer?.prompt),
          options: options.map((option, i) => ({
            id: OPTION_IDS[i] ?? `option${i + 1}`,
            text: option.text,
            ...(option.why ? { why: option.why } : {}),
          })),
          accepted: options.flatMap((option, i) => (option.correct ? [OPTION_IDS[i]] : [])),
          explanation: text(layer?.explanation),
        }
      })
      .filter((layer) => layer.key || layer.prompt || layer.options.length)

    const problem: Record<string, unknown> = {
      $schema: '../../schema/problem.schema.json',
      schemaVersion: 1,
      id: text(input.id),
      status: text(input.status) || 'draft',
      author: text(input.author),
      collection: text(input.collection) || 'community',
      title: text(input.title),
      source: text(input.source),
      url: text(input.url),
      difficulty: {
        tier: text(input.difficulty?.tier),
        scale: text(input.difficulty?.scale),
        value: text(input.difficulty?.value),
      },
      summary: text(input.summary),
      constraints: {
        text: text(input.constraints?.text),
        verified: isOn(input.constraints?.verified),
      },
      answers: {
        subjects: answers(input.subjects),
        techniques: answers(input.techniques),
      },
    }
    const appearsIn = strings(input.appearsIn)
    if (appearsIn.length) problem.appearsIn = appearsIn
    problem.distractors = strings(input.distractors)
    problem.explanation = text(input.explanation)
    problem.traps = strings(input.traps)
    problem.pairWith = strings(input.pairWith)
    problem.extraLayers = extraLayers
    const notes = text(input.notes)
    if (notes) problem.notes = notes
    problem.deprecated = isOn(input.deprecated)

    return problem as unknown as ProblemFile
  }

  toJson(problem: ProblemFile) {
    return `${JSON.stringify(problem, null, 2)}\n`
  }

  path(problem: ProblemFile) {
    const subject = intendedSubject(problem)
    return problem.id && subject ? `problems/${subject}/${problem.id}.json` : null
  }

  /**
   * The file of an existing problem, for edit mode. Null if the id isn't in
   * the database or its file can't be read.
   */
  async load(id: string): Promise<ProblemFile | null> {
    const problem = await Problem.find(id)
    if (!problem) return null
    try {
      return JSON.parse(await readFile(join(contentConfig.dir, problem.sourcePath), 'utf8'))
    } catch {
      return null
    }
  }

  async check(problem: ProblemFile, editing: string | null): Promise<DraftCheck> {
    const [taxonomy, existing] = await Promise.all([
      this.catalog.taxonomy(),
      Problem.query().select('id'),
    ])
    const problemIds = new Set(existing.map((p) => p.id))

    const errors = await this.loader.checkDraft(contentConfig.dir, problem, {
      subjectIds: new Set(taxonomy.subjects.map((s) => s.id)),
      techniqueSubject: new Map(taxonomy.techniques.map((t) => [t.id, t.subjectId])),
      problemIds,
    })
    const warnings: string[] = []

    if (problem.id && problem.id !== editing && problemIds.has(problem.id)) {
      errors.push(`id ${problem.id} is already taken (ids are permanent; pick another)`)
    }
    if (problem.url && !hostAllowed(problem.url)) {
      errors.push("url: the judge's host isn't on the allowlist in scripts/validate.ts")
    }
    const leaks = leakedWords(problem.summary ?? '')
    if (leaks.length) {
      // A warning, not an error: the summary is the original statement, so it
      // can't be reworded. The author decides whether the problem still works.
      const words = leaks.map((w) => `"${w}"`).join(', ')
      warnings.push(`the statement names the technique (${words}), which gives the answer away`)
    }
    if (problem.status === 'ready' && !problem.constraints?.verified) {
      warnings.push('ready, but the constraints are not marked as verified')
    }
    return { errors, warnings }
  }

  async preview(problem: ProblemFile, editing: string | null): Promise<DraftPreview> {
    const json = this.toJson(problem)
    const path = this.path(problem)
    const name = `${problem.id || 'problem'}.json`
    return {
      json,
      path,
      check: await this.check(problem, editing),
      started: Boolean(problem.id || problem.title || problem.summary),
      downloadName: name,
      downloadHref: `data:application/json;charset=utf-8,${encodeURIComponent(json)}`,
      github: await this.githubLink(problem, json, editing),
    }
  }

  /**
   * New file: GitHub's editor pre-filled with the JSON (it forks and opens a
   * PR for people without write access). Existing file: its edit page, where
   * the JSON has to be pasted.
   */
  protected async githubLink(problem: ProblemFile, json: string, editing: string | null) {
    const subject = intendedSubject(problem)
    if (!problem.id || !subject) return null

    if (editing && editing === problem.id) {
      const existing = await Problem.find(editing)
      if (existing) {
        return {
          url: `${contentConfig.repoUrl}/edit/main/${existing.sourcePath}`,
          prefilled: false,
        }
      }
    }
    const query = new URLSearchParams({ filename: `${problem.id}.json`, value: json })
    const url = `${contentConfig.repoUrl}/new/main/problems/${subject}?${query}`
    return url.length <= MAX_GITHUB_URL ? { url, prefilled: true } : null
  }

  /**
   * Dropdown choices, read from the content repo's schema so they can't drift.
   */
  async choices(): Promise<SchemaChoices> {
    try {
      const schema = JSON.parse(
        await readFile(join(contentConfig.dir, 'schema/problem.schema.json'), 'utf8')
      )
      return {
        sources: schema.properties.source.enum,
        scales: schema.properties.difficulty.properties.scale.enum,
        tiers: schema.properties.difficulty.properties.tier.enum,
        kinds: schema.$defs.layer.properties.kind.enum,
      }
    } catch {
      return {
        sources: ['Other'],
        scales: ['estimate'],
        tiers: ['easy', 'medium', 'hard'],
        kinds: ['custom'],
      }
    }
  }
}

function intendedSubject(problem: ProblemFile) {
  return problem.answers?.subjects?.find((s) => s.role === 'intended')?.id ?? null
}

/**
 * Form arrays arrive as arrays, or as objects when indices are sparse or large.
 */
function rows(value: unknown): any[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return Object.values(value)
  return []
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function strings(value: unknown) {
  return [...new Set(rows(value).map(text).filter(Boolean))]
}

function isOn(value: unknown) {
  return value === true || value === 'on' || value === 'true' || value === '1'
}
