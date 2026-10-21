import type { Complexity } from '#types/content'

/**
 * Drills: short questions between problems (D-065, plan §6.9).
 *
 * | kind              | asks                                                  |
 * | ----------------- | ----------------------------------------------------- |
 * | `max-big-o`       | n ≤ X: the largest complexity that fits in 1 second  |
 * | `algorithm-big-o` | the time complexity of an algorithm of the subject    |
 * | `max-n`           | up to roughly which n a complexity fits               |
 * | `fits`            | complexity + n: does it fit?                          |
 */
export const DRILL_KINDS = ['max-big-o', 'algorithm-big-o', 'max-n', 'fits'] as const
export type DrillKind = (typeof DRILL_KINDS)[number]

/** drill_items.data for "general:big-o". */
export interface BigOTableData {
  opsPerSecond: number
  complexities: Complexity[]
  nValues: number[]
}

/** drill_items.data for an algorithm. */
export interface AlgorithmData {
  name: string
  complexity: string
  wrong: string[]
  explanation: string
  explanationEs: string | null
}

/** One entry of `lessons.items`. */
export type LessonItem =
  { type: 'problem'; id: string } | { type: 'drill'; kind: DrillKind; algorithmId?: string }
