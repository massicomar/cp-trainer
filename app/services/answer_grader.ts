import type { Question } from '#services/question_builder'
import type { Outcome } from '#types/play'

/**
 * Grades a picked option on the server. The roles behind the options never
 * reach the page before the player answers.
 *
 * | picked option's role | outcome  |
 * | -------------------- | -------- |
 * | intended / accepted  | correct  |
 * | overkill             | overkill |
 * | anything else        | wrong    |
 *
 * `gave_up` and `skipped` don't involve a pick; LessonFlow records them.
 */
export default class AnswerGrader {
  /**
   * Null when `chosen` isn't one of the question's options (a stale or forged
   * form), so the caller can ignore the request.
   */
  grade(question: Question, chosen: string): Outcome | null {
    const option = question.options.find((o) => o.id === chosen)
    if (!option) return null
    return option.role
  }

  /**
   * Correct and overkill both count as right in scores; gave_up counts as
   * wrong; skipped layers aren't counted at all.
   */
  static countsAsRight(outcome: Outcome) {
    return outcome === 'correct' || outcome === 'overkill'
  }
}
