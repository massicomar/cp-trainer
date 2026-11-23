import type { AnswerRole, Tier } from '#types/content'
import type { DrillKind } from '#types/drills'

export const TIERS: Tier[] = ['easy', 'medium', 'hard']

/**
 * What a session draws from: any non-empty set of visible subjects and tiers,
 * with or without community-added problems, with or without drills.
 *
 * The last three are Custom options (plan §12.7); anonymous rounds leave them
 * out, which means "all of them" and "with problems".
 */
export interface Selection {
  subjects: string[]
  tiers: Tier[]
  includeCommunity: boolean
  includeDrills: boolean
  /** Short questions only, no problems (needs `includeDrills`). */
  drillsOnly?: boolean
  /** Only problems with one of these techniques; null for all of them. */
  techniques?: string[] | null
  /** Only these kinds of short questions; null for all of them. */
  drillKinds?: DrillKind[] | null
}

export type Outcome = 'correct' | 'overkill' | 'wrong' | 'gave_up' | 'skipped'

/**
 * How an option grades if picked. Never sent to the page before answering.
 */
export type OptionRole = 'correct' | 'overkill' | 'wrong'

export interface SubjectInfo {
  id: string
  name: string
  hidden: boolean
  position: number
}

export interface TechniqueInfo {
  id: string
  subjectId: string
  name: string
  confusableWith: string[]
  position: number
}

export interface AnswerRef {
  kind: 'subject' | 'technique'
  id: string
  role: AnswerRole
}
