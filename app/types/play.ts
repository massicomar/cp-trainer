import type { AnswerRole, Tier } from '#types/content'

export const TIERS: Tier[] = ['easy', 'medium', 'hard']

/**
 * What a session draws from: any non-empty set of visible subjects and tiers.
 */
export interface Selection {
  subjects: string[]
  tiers: Tier[]
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
