import db from '@adonisjs/lucid/services/db'
import { playableStatuses } from '#config/content'
import Subject from '#models/subject'
import Technique from '#models/technique'
import type { Tier } from '#types/content'
import { DRILL_KINDS } from '#types/drills'
import { TIERS, type Selection } from '#types/play'

/** Answer roles that put a problem under a technique (not overkill). */
const TECHNIQUE_ROLES = ['intended', 'accepted']

/**
 * A technique Custom can filter by: one with at least one playable problem
 * (any tier), and how many.
 */
export interface TechniqueChoice {
  id: string
  subjectId: string
  name: string
  count: number
}

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
   *
   * Drills are included unless the form says `drills=off` without `on` (the
   * checkbox sits after a hidden "off", so a ticked box posts both) or a
   * stored selection says `includeDrills: false`.
   *
   * Custom adds (plan §12.7):
   * - `drills=only` (or `drillsOnly: true`): short questions only.
   * - `techniques`: a filter, sent with a `techniqueFilter` marker so an
   *   all-unticked form differs from no filter. Techniques outside the
   *   selected subjects are dropped, and ticking every one of `choices` for
   *   each selected subject means no filter (null).
   * - `drillKinds`: the kinds of short questions, with a `drillKindFilter`
   *   marker; all four means null.
   */
  normalize(
    input: {
      subjects?: unknown
      tiers?: unknown
      problems?: unknown
      includeCommunity?: unknown
      drills?: unknown
      includeDrills?: unknown
      drillsOnly?: unknown
      techniques?: unknown
      techniqueFilter?: unknown
      drillKinds?: unknown
      drillKindFilter?: unknown
    },
    visibleIds: string[],
    choices: TechniqueChoice[] = []
  ): Selection {
    const subjects = visibleIds.filter((id) => asStrings(input.subjects).includes(id))
    const tiers = new Set(asStrings(input.tiers))
    const drills = asStrings(input.drills)
    const includeDrills =
      !(drills.includes('off') && !drills.includes('on')) && input.includeDrills !== false

    const selection: Selection = {
      subjects,
      tiers: TIERS.filter((tier) => tiers.has(tier)),
      includeCommunity: input.problems !== 'official' && input.includeCommunity !== false,
      includeDrills,
    }
    if (includeDrills && (drills.includes('only') || input.drillsOnly === true)) {
      selection.drillsOnly = true
    }

    const techniques =
      input.techniqueFilter !== undefined || Array.isArray(input.techniques)
        ? asStrings(input.techniques)
        : null
    if (techniques) selection.techniques = narrowTechniques(techniques, subjects, choices)

    const kinds =
      input.drillKindFilter !== undefined || Array.isArray(input.drillKinds)
        ? asStrings(input.drillKinds)
        : null
    if (kinds) {
      const picked = DRILL_KINDS.filter((kind) => kinds.includes(kind))
      selection.drillKinds = picked.length === DRILL_KINDS.length ? null : picked
    }
    return selection
  }

  /**
   * Enough to start a round: a subject, and a tier unless the round is
   * short questions only. A technique filter needs a technique left (unless
   * there are no problems to filter), and short questions need a kind.
   */
  isComplete(selection: Selection) {
    return this.missing(selection) === null
  }

  /** What `isComplete` is missing, for the message; null when nothing is. */
  missing(selection: Selection): 'subjects' | 'tiers' | 'techniques' | 'drillKinds' | null {
    if (!selection.subjects.length) return 'subjects'
    if (!selection.tiers.length && !selection.drillsOnly) return 'tiers'
    if (selection.techniques && !selection.techniques.length && !selection.drillsOnly) {
      return 'techniques'
    }
    if (selection.includeDrills && selection.drillKinds && !selection.drillKinds.length) {
      return 'drillKinds'
    }
    return null
  }

  /**
   * What a Custom "Start" plays: the player's last selection, or on the
   * first time all subjects · easy + medium · with short questions.
   */
  startingPoint(
    saved: Selection | null | undefined,
    visibleIds: string[],
    choices: TechniqueChoice[]
  ): Selection {
    const last = saved ? this.normalize(saved, visibleIds, choices) : null
    if (last && this.isComplete(last)) return last
    return {
      subjects: visibleIds,
      tiers: ['easy', 'medium'],
      includeCommunity: true,
      includeDrills: true,
    }
  }

  async count(selection: Selection): Promise<number> {
    if (!this.isComplete(selection) || !selection.tiers.length) return 0
    const [row] = await this.matching(selection).countDistinct('problems.id as total')
    return Number(row.total)
  }

  /**
   * The techniques Custom offers, in taxonomy order, each with its number of
   * playable problems (all tiers, as the subject chips count). A problem
   * counts under its intended and accepted techniques.
   */
  async techniqueChoices(): Promise<TechniqueChoice[]> {
    const [techniques, rows] = await Promise.all([
      Technique.query().where('deprecated', false).orderBy('position'),
      db
        .from('problems')
        .join('problem_answers', 'problem_answers.problem_id', 'problems.id')
        .where('problems.deprecated', false)
        .whereIn('problems.status', playableStatuses())
        .where('problem_answers.kind', 'technique')
        .whereIn('problem_answers.role', TECHNIQUE_ROLES)
        .groupBy('problem_answers.answer_id')
        .select('problem_answers.answer_id')
        .countDistinct('problems.id as total'),
    ])
    const counts = new Map(rows.map((row) => [row.answer_id as string, Number(row.total)]))
    return techniques
      .filter((technique) => counts.has(technique.id))
      .map((technique) => ({
        id: technique.id,
        subjectId: technique.subjectId,
        name: technique.name,
        count: counts.get(technique.id)!,
      }))
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
    if (selection.techniques) {
      query.whereIn(
        'problems.id',
        db
          .from('problem_answers')
          .where('kind', 'technique')
          .whereIn('role', TECHNIQUE_ROLES)
          .whereIn('answer_id', selection.techniques)
          .select('problem_id')
      )
    }
    return query
  }
}

/**
 * The ticked techniques that belong to a selected subject, in taxonomy
 * order; null when that is every choice of every selected subject.
 */
function narrowTechniques(
  ticked: string[],
  subjects: string[],
  choices: TechniqueChoice[]
): string[] | null {
  const relevant = choices.filter((choice) => subjects.includes(choice.subjectId))
  const kept = relevant.filter((choice) => ticked.includes(choice.id)).map((choice) => choice.id)
  return kept.length === relevant.length ? null : kept
}

/**
 * The query string that reopens the setup (or the Custom panel) with this
 * selection, for "Change selection".
 */
export function selectionQuery(selection: Selection): string {
  const query = new URLSearchParams()
  for (const subject of selection.subjects) query.append('subjects[]', subject)
  for (const tier of selection.tiers) query.append('tiers[]', tier)
  if (!selection.includeCommunity) query.append('problems', 'official')
  if (selection.drillsOnly) query.append('drills', 'only')
  else if (!selection.includeDrills) query.append('drills', 'off')
  if (selection.techniques) {
    query.append('techniqueFilter', 'on')
    for (const id of selection.techniques) query.append('techniques[]', id)
  }
  if (selection.drillKinds) {
    query.append('drillKindFilter', 'on')
    for (const kind of selection.drillKinds) query.append('drillKinds[]', kind)
  }
  return query.toString()
}

function asStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  return []
}
