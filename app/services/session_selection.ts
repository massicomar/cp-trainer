import db from '@adonisjs/lucid/services/db'
import { playableStatuses } from '#config/content'
import Subject from '#models/subject'
import type { Tier } from '#types/content'
import { TIERS, type Selection } from '#types/play'

/**
 * Which subjects and tiers a session draws from, and how many problems match.
 *
 * A problem matches when it is playable (ready, or draft in preview mode), not
 * deprecated, in one of the tiers, and belongs to one of the subjects through
 * `problem_subjects` (intended subject, accepted subject with its own
 * technique, or appearsIn for distractors).
 */
export default class SessionSelection {
  /**
   * Subjects a player can pick, in taxonomy order. Hidden subjects ("None of
   * these") are answers only.
   */
  async visibleSubjects() {
    return Subject.query().where('hidden', false).where('deprecated', false).orderBy('position')
  }

  /**
   * Keeps known visible subjects and valid tiers, in canonical order, dropping
   * anything else. Accepts a single string or an array for each field, as
   * query strings and forms produce either.
   *
   * Community problems are included unless the form says `problems=official`
   * or a stored selection says `includeCommunity: false`.
   */
  normalize(
    input: { subjects?: unknown; tiers?: unknown; problems?: unknown; includeCommunity?: unknown },
    visibleIds: string[]
  ): Selection {
    const subjects = new Set(asStrings(input.subjects))
    const tiers = new Set(asStrings(input.tiers))
    return {
      subjects: visibleIds.filter((id) => subjects.has(id)),
      tiers: TIERS.filter((tier) => tiers.has(tier)),
      includeCommunity: input.problems !== 'official' && input.includeCommunity !== false,
    }
  }

  isComplete(selection: Selection) {
    return selection.subjects.length > 0 && selection.tiers.length > 0
  }

  async count(selection: Selection): Promise<number> {
    if (!this.isComplete(selection)) return 0
    const [row] = await this.matching(selection).countDistinct('problems.id as total')
    return Number(row.total)
  }

  /**
   * Matching problems per subject, for the counts on the subject chips. A
   * problem in two selected subjects counts once for each.
   */
  async countBySubject(tiers: Tier[]): Promise<Record<string, number>> {
    if (!tiers.length) return {}
    const rows = await db
      .from('problems')
      .join('problem_subjects', 'problem_subjects.problem_id', 'problems.id')
      .where('problems.deprecated', false)
      .whereIn('problems.status', playableStatuses())
      .whereIn('problems.tier', tiers)
      .groupBy('problem_subjects.subject_id')
      .select('problem_subjects.subject_id')
      .countDistinct('problems.id as total')
    return Object.fromEntries(rows.map((row) => [row.subject_id, Number(row.total)]))
  }

  /**
   * Base query over problems joined with their session subjects.
   */
  matching(selection: Selection) {
    const query = db
      .from('problems')
      .join('problem_subjects', 'problem_subjects.problem_id', 'problems.id')
      .where('problems.deprecated', false)
      .whereIn('problems.status', playableStatuses())
      .whereIn('problems.tier', selection.tiers)
      .whereIn('problem_subjects.subject_id', selection.subjects)
    if (!selection.includeCommunity) query.where('problems.collection', 'official')
    return query
  }
}

function asStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  return []
}
