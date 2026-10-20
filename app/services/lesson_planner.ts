import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import SessionSelection from '#services/session_selection'
import { shuffle, type Random } from '#services/random'
import type { Tier } from '#types/content'
import { TIERS, type Selection } from '#types/play'

export const LESSON_SIZE = 5

/** Outcomes that send a problem to the "review" bucket. */
const NEEDS_REVIEW = new Set(['wrong', 'gave_up', 'skipped'])

export interface Candidate {
  id: string
  tier: Tier
  /** The selected subject whose turn this problem is played in. */
  pool: string
  /** In the session only through `appearsIn`. */
  distractor: boolean
  pairWith: string[]
}

export interface PlayerHistory {
  /** Problems the player has any attempt on. */
  seen: Set<string>
  /** Problems whose most recent lesson had a wrong / gave_up / skipped layer. */
  review: Set<string>
}

/**
 * Picks the problems for a lesson (MVP rules, plan §6.7):
 *
 * 1. Round-robin over the selected subjects, starting from a random one, one
 *    problem per subject per turn. Subjects with nothing left are skipped.
 * 2. Within a subject: unseen problems first (easy → hard, random within a
 *    tier), then ones to review, then the rest.
 * 3. A chosen problem's unseen `pairWith` partner (if it matches the
 *    selection) goes right after it and counts toward the lesson size.
 * 4. At most one distractor (`appearsIn`) problem per lesson.
 * 5. Fewer matches than the lesson size → a shorter lesson.
 */
export function pickProblems(
  candidates: Candidate[],
  subjects: string[],
  history: PlayerHistory,
  random: Random,
  size = LESSON_SIZE
): string[] {
  const byId = new Map(candidates.map((c) => [c.id, c]))
  const queues = new Map<string, Candidate[]>()
  for (const subject of subjects) {
    const own = candidates.filter((c) => c.pool === subject)
    if (own.length) queues.set(subject, orderPool(own, history, random))
  }

  const turnOrder = [...queues.keys()]
  const start = Math.floor(random() * turnOrder.length)
  const rotation = [...turnOrder.slice(start), ...turnOrder.slice(0, start)]

  const chosen: string[] = []
  let distractors = 0
  const allowed = (c: Candidate) => !chosen.includes(c.id) && (!c.distractor || distractors < 1)
  const take = (c: Candidate) => {
    chosen.push(c.id)
    if (c.distractor) distractors++
  }

  let progressed = true
  while (chosen.length < size && progressed) {
    progressed = false
    for (const subject of rotation) {
      if (chosen.length >= size) break
      const queue = queues.get(subject)!
      let next: Candidate | undefined
      while (queue.length && !next) {
        const candidate = queue.shift()!
        if (allowed(candidate)) next = candidate
      }
      if (!next) continue

      take(next)
      progressed = true
      for (const partnerId of next.pairWith) {
        const partner = byId.get(partnerId)
        if (chosen.length < size && partner && !history.seen.has(partnerId) && allowed(partner)) {
          take(partner)
        }
      }
    }
  }
  return chosen
}

function orderPool(pool: Candidate[], history: PlayerHistory, random: Random) {
  const tierRank = (tier: Tier) => TIERS.indexOf(tier)
  const unseen = shuffle(
    pool.filter((c) => !history.seen.has(c.id)),
    random
  ).sort((a, b) => tierRank(a.tier) - tierRank(b.tier))
  const review = shuffle(
    pool.filter((c) => history.seen.has(c.id) && history.review.has(c.id)),
    random
  )
  const rest = shuffle(
    pool.filter((c) => history.seen.has(c.id) && !history.review.has(c.id)),
    random
  )
  return [...unseen, ...review, ...rest]
}

/**
 * Loads the matching problems and the player's history, then picks.
 */
@inject()
export default class LessonPlanner {
  constructor(protected selection: SessionSelection) {}

  async plan(playerId: string, selection: Selection, random: Random = Math.random) {
    const [candidates, history] = await Promise.all([
      this.candidates(selection),
      this.history(playerId),
    ])
    return pickProblems(candidates, selection.subjects, history, random)
  }

  async candidates(selection: Selection): Promise<Candidate[]> {
    const rows = await this.selection
      .matching(selection)
      .select(
        'problems.id',
        'problems.tier',
        'problems.pair_with',
        'problem_subjects.subject_id',
        'problem_subjects.role',
        'problem_subjects.via'
      )
      .orderBy('problems.id')

    const grouped = new Map<string, typeof rows>()
    for (const row of rows) grouped.set(row.id, [...(grouped.get(row.id) ?? []), row])

    return [...grouped.values()].map((memberships) => {
      // Play it in the turn of its intended subject if selected, else an
      // accepted one, else the appearsIn subject that brought it in.
      const home =
        memberships.find((m) => m.role === 'intended') ??
        memberships.find((m) => m.via === 'answer') ??
        memberships[0]
      return {
        id: home.id,
        tier: home.tier,
        pool: home.subject_id,
        distractor: home.via === 'appearsIn',
        pairWith: JSON.parse(home.pair_with),
      }
    })
  }

  async history(playerId: string): Promise<PlayerHistory> {
    const rows = await db
      .from('attempts')
      .where('player_id', playerId)
      .select('problem_id', 'lesson_id', 'outcome')

    const latestLesson = new Map<string, number>()
    for (const row of rows) {
      latestLesson.set(
        row.problem_id,
        Math.max(latestLesson.get(row.problem_id) ?? 0, row.lesson_id)
      )
    }
    const review = new Set<string>()
    for (const row of rows) {
      if (row.lesson_id === latestLesson.get(row.problem_id) && NEEDS_REVIEW.has(row.outcome)) {
        review.add(row.problem_id)
      }
    }
    return { seen: new Set(latestLesson.keys()), review }
  }
}
