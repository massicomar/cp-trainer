import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import Layer from '#models/layer'
import Problem from '#models/problem'
import Subject from '#models/subject'
import Technique from '#models/technique'
import ContentLoader from '#services/content_loader'
import type { ContentIssue, LoadedContent, ProblemFile } from '#types/content'

export interface SyncReport {
  subjects: number
  techniques: number
  problems: {
    total: number
    ready: number
    draft: number
    /** Files with "deprecated": true */
    retired: number
    added: number
    changed: number
    unchanged: number
    /** In the database but no longer in the repo; marked deprecated by this sync */
    missing: number
  }
  layers: {
    active: number
    /** Marked deprecated by this sync (problem or extraLayer removed) */
    deprecated: number
  }
}

export type SyncResult = { ok: true; report: SyncReport } | { ok: false; errors: ContentIssue[] }

const SUBJECT_PROMPT = 'Which subject does this problem belong to?'
const TECHNIQUE_PROMPT = 'Which technique solves it?'

/** Keeps multi-row inserts well under SQLite's per-statement limits. */
const INSERT_CHUNK = 100

/**
 * Copies the content repo into SQLite. The JSON files stay the source of
 * truth; these tables are a rebuildable index of them.
 *
 * Everything is written in one transaction and only after the whole repo
 * validates, so a bad file never leaves the database half-updated. Rows are
 * never deleted: problems, layers, subjects and techniques that disappear from
 * the repo are marked `deprecated`, which keeps future attempt history valid.
 */
@inject()
export default class ContentSync {
  constructor(protected loader: ContentLoader) {}

  async syncDirectory(root: string): Promise<SyncResult> {
    const loaded = await this.loader.load(root)
    if (!loaded.ok) return loaded
    return { ok: true, report: await this.apply(loaded.content) }
  }

  async apply(content: LoadedContent): Promise<SyncReport> {
    return db.transaction(async (trx) => {
      const subjects = await this.syncTaxonomy(content, trx)
      const problems = await this.syncProblems(content, trx)
      await this.syncAnswers(content, trx)
      const layers = await this.syncLayers(content, trx)

      return { ...subjects, problems, layers }
    })
  }

  protected async syncTaxonomy(content: LoadedContent, trx: TransactionClientContract) {
    const subjectRows = content.taxonomy.subjects.map((subject, position) => ({
      id: subject.id,
      name: subject.name,
      position,
      hidden: subject.hidden ?? false,
      deprecated: false,
    }))
    const techniqueRows = content.taxonomy.subjects.flatMap((subject) =>
      subject.techniques.map((technique, position) => ({
        id: technique.id,
        subjectId: subject.id,
        name: technique.name,
        position,
        confusableWith: technique.confusableWith ?? [],
        deprecated: false,
      }))
    )

    await Subject.updateOrCreateMany('id', subjectRows, { client: trx })
    await Subject.query({ client: trx })
      .whereNotIn(
        'id',
        subjectRows.map((row) => row.id)
      )
      .update({ deprecated: true })

    await Technique.updateOrCreateMany('id', techniqueRows, { client: trx })
    await Technique.query({ client: trx })
      .whereNotIn(
        'id',
        techniqueRows.map((row) => row.id)
      )
      .update({ deprecated: true })

    return { subjects: subjectRows.length, techniques: techniqueRows.length }
  }

  protected async syncProblems(content: LoadedContent, trx: TransactionClientContract) {
    const existingRows = await Problem.query({ client: trx }).select(
      'id',
      'content_hash',
      'deprecated'
    )
    const existing = new Map(existingRows.map((p) => [p.id, p]))
    const syncedAt = DateTime.now()
    const loadedIds = new Set(content.problems.map(({ problem }) => problem.id))

    const counts = { added: 0, changed: 0, unchanged: 0 }
    for (const { problem, hash } of content.problems) {
      const before = existing.get(problem.id)
      if (!before) counts.added++
      else if (before.contentHash !== hash) counts.changed++
      else counts.unchanged++
    }

    const rows = content.problems.map(({ problem, file, hash }) => ({
      id: problem.id,
      status: problem.status,
      author: problem.author,
      collection: problem.collection,
      title: problem.title,
      source: problem.source,
      url: problem.url,
      tier: problem.difficulty.tier,
      difficultyScale: problem.difficulty.scale,
      difficultyValue: problem.difficulty.value,
      summaryMd: problem.summary,
      constraintsText: problem.constraints.text,
      constraintsVerified: problem.constraints.verified,
      explanationMd: problem.explanation,
      traps: problem.traps ?? [],
      pairWith: problem.pairWith ?? [],
      distractors: problem.distractors ?? [],
      deprecated: problem.deprecated,
      sourcePath: file,
      contentHash: hash,
      syncedAt,
    }))
    await Problem.updateOrCreateMany('id', rows, { client: trx })

    const missing = [...existing.values()].filter((p) => !loadedIds.has(p.id) && !p.deprecated)
    if (missing.length) {
      await Problem.query({ client: trx })
        .whereIn(
          'id',
          missing.map((p) => p.id)
        )
        .update({ deprecated: true })
    }

    const ready = content.problems.filter(({ problem }) => problem.status === 'ready').length
    return {
      total: content.problems.length,
      ready,
      draft: content.problems.length - ready,
      retired: content.problems.filter(({ problem }) => problem.deprecated).length,
      ...counts,
      missing: missing.length,
    }
  }

  /**
   * problem_answers and problem_subjects are fully derived from the files, so
   * they're replaced rather than diffed. Rows of problems that left the repo
   * are kept, like the problems themselves.
   */
  protected async syncAnswers(content: LoadedContent, trx: TransactionClientContract) {
    const ids = content.problems.map(({ problem }) => problem.id)
    await trx.from('problem_answers').whereIn('problem_id', ids).delete()
    await trx.from('problem_subjects').whereIn('problem_id', ids).delete()

    const answerRows = content.problems.flatMap(({ problem }) => [
      ...problem.answers.subjects.map((answer) => ({
        problem_id: problem.id,
        kind: 'subject',
        answer_id: answer.id,
        role: answer.role,
      })),
      ...problem.answers.techniques.map((answer) => ({
        problem_id: problem.id,
        kind: 'technique',
        answer_id: answer.id,
        role: answer.role,
      })),
    ])
    const subjectRows = content.problems.flatMap(({ problem }) => sessionSubjects(problem))

    for (let i = 0; i < answerRows.length; i += INSERT_CHUNK) {
      await trx.table('problem_answers').multiInsert(answerRows.slice(i, i + INSERT_CHUNK))
    }
    for (let i = 0; i < subjectRows.length; i += INSERT_CHUNK) {
      await trx.table('problem_subjects').multiInsert(subjectRows.slice(i, i + INSERT_CHUNK))
    }
  }

  protected async syncLayers(content: LoadedContent, trx: TransactionClientContract) {
    const rows = content.problems.flatMap(({ problem }) => layerRows(problem))
    await Layer.updateOrCreateMany('id', rows, { client: trx })

    const activeIds = new Set(rows.map((row) => row.id))
    const current = await Layer.query({ client: trx }).where('deprecated', false).select('id')
    const stale = current.map((layer) => layer.id).filter((id) => !activeIds.has(id))
    if (stale.length) {
      await Layer.query({ client: trx }).whereIn('id', stale).update({ deprecated: true })
    }

    return { active: rows.length, deprecated: stale.length }
  }
}

/**
 * Which sessions a problem shows up in:
 * - its intended subject;
 * - an accepted subject, if the problem also lists a technique of that subject
 *   (so the technique layer has something to ask);
 * - every `appearsIn` subject (distractors).
 */
export function sessionSubjects(problem: ProblemFile) {
  const techniqueSubjects = new Set(problem.answers.techniques.map((t) => t.id.split('.')[0]))
  const rows: { problem_id: string; subject_id: string; role: string | null; via: string }[] = []

  for (const answer of problem.answers.subjects) {
    const counts =
      answer.role === 'intended' || (answer.role === 'accepted' && techniqueSubjects.has(answer.id))
    if (counts) {
      rows.push({ problem_id: problem.id, subject_id: answer.id, role: answer.role, via: 'answer' })
    }
  }
  for (const subjectId of problem.appearsIn ?? []) {
    if (!rows.some((row) => row.subject_id === subjectId)) {
      rows.push({ problem_id: problem.id, subject_id: subjectId, role: null, via: 'appearsIn' })
    }
  }
  return rows
}

/**
 * Layer 1 (subject), layer 2 (technique), then the file's extraLayers in order.
 */
export function layerRows(problem: ProblemFile) {
  const correct = (refs: { id: string; role: string }[]) =>
    refs.filter((ref) => ref.role === 'intended' || ref.role === 'accepted').map((ref) => ref.id)

  return [
    {
      id: `${problem.id}:subject`,
      problemId: problem.id,
      position: 1,
      kind: 'subject',
      prompt: SUBJECT_PROMPT,
      options: null,
      accepted: correct(problem.answers.subjects),
      // Nothing to explain yet: the problem's explanation names the technique.
      explanationMd: null,
      deprecated: false,
    },
    {
      id: `${problem.id}:technique`,
      problemId: problem.id,
      position: 2,
      kind: 'technique',
      prompt: TECHNIQUE_PROMPT,
      options: null,
      accepted: correct(problem.answers.techniques),
      explanationMd: problem.explanation,
      deprecated: false,
    },
    ...(problem.extraLayers ?? []).map((layer, index) => ({
      id: `${problem.id}:${layer.key}`,
      problemId: problem.id,
      position: 3 + index,
      kind: layer.kind,
      prompt: layer.prompt,
      options: layer.options,
      accepted: layer.accepted,
      explanationMd: layer.explanation,
      deprecated: false,
    })),
  ]
}
