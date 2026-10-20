import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import Attempt from '#models/attempt'
import Lesson from '#models/lesson'
import type Player from '#models/player'
import type Problem from '#models/problem'
import AnswerGrader from '#services/answer_grader'
import Catalog, { type ProblemBundle, type Taxonomy } from '#services/catalog'
import LessonPlanner from '#services/lesson_planner'
import QuestionBuilder, { type Question } from '#services/question_builder'
import type { Outcome, Selection } from '#types/play'

/**
 * What the lesson page shows right now: a question, or (once `attempt` is
 * set) the feedback for it.
 */
export interface PlayState {
  lesson: Lesson
  problem: Problem
  problemNumber: number
  problemCount: number
  stepNumber: number
  stepCount: number
  question: Question
  /** Set once the current layer is answered: the page shows feedback. */
  attempt: Attempt | null
  feedback: Feedback | null
  /** The problem's last layer: its feedback also reveals the title, link and traps. */
  isLastStep: boolean
  isLastProblem: boolean
  /** One entry per problem in the lesson. */
  progress: ('done' | 'current' | 'todo')[]
  subjectNames: string[]
}

/**
 * The answered question, ready to display: which options to color and what
 * to say.
 */
export interface Feedback {
  outcome: Outcome
  options: {
    id: string
    text: string
    /** right: correct answer · overkill: works but heavier · picked-wrong: the player's wrong pick */
    mark: 'right' | 'overkill' | 'picked-wrong' | 'none'
    picked: boolean
  }[]
  /** The authored note on the picked option, if any. */
  pickedWhy: string | null
  expectedText: string
  explanation: string | null
}

export interface LayerScore {
  kind: string
  label: string
  right: number
  total: number
}

export interface LessonSummary {
  lesson: Lesson
  scores: LayerScore[]
  problems: {
    problem: Problem
    results: { label: string; outcome: Outcome }[]
  }[]
}

interface Position {
  lesson: Lesson
  taxonomy: Taxonomy
  bundle: ProblemBundle
  steps: ProblemBundle['layers']
  step: ProblemBundle['layers'][number]
  attempts: Attempt[]
}

const KIND_LABELS: Record<string, string> = {
  'subject': 'Subject',
  'technique': 'Technique',
  'dp-state': 'DP state',
  'dp-transition': 'DP transition',
  'complexity': 'Complexity',
  'observation': 'Observation',
  'node-stores': 'Node contents',
  'trap': 'Trap',
}

/**
 * The lesson state machine. The cursor (problem index, layer index) is stored
 * on the lesson row; whether the current layer was answered is derived from
 * its attempt. Requests that don't match the current state (a stale tab, a
 * double click) are ignored, so the caller can always just re-render.
 */
@inject()
export default class LessonFlow {
  constructor(
    protected catalog: Catalog,
    protected builder: QuestionBuilder,
    protected grader: AnswerGrader,
    protected planner: LessonPlanner
  ) {}

  /**
   * Null when nothing matches the selection.
   */
  async create(player: Player, selection: Selection): Promise<Lesson | null> {
    const problemIds = await this.planner.plan(player.id, selection)
    if (!problemIds.length) return null

    player.preferences = selection
    await player.save()

    return Lesson.create({
      playerId: player.id,
      subjectIds: selection.subjects,
      tiers: selection.tiers,
      problemIds,
      cursorProblem: 0,
      cursorLayer: 0,
      layerStartedAt: DateTime.now(),
      status: 'active',
    })
  }

  /**
   * Null once the lesson is done.
   */
  async state(lesson: Lesson): Promise<PlayState | null> {
    const position = await this.position(lesson)
    if (!position) return null

    const { bundle, taxonomy, steps, step, attempts } = position
    const stepIndex = steps.indexOf(step)
    const question = this.question(position)
    const attempt = attempts.find((a) => a.layerId === step.id) ?? null
    return {
      lesson,
      problem: bundle.problem,
      problemNumber: lesson.cursorProblem + 1,
      problemCount: lesson.problemIds.length,
      stepNumber: stepIndex + 1,
      stepCount: steps.length,
      question,
      attempt,
      feedback: attempt ? feedbackFor(question, attempt) : null,
      isLastStep: stepIndex === steps.length - 1,
      isLastProblem: lesson.cursorProblem === lesson.problemIds.length - 1,
      progress: lesson.problemIds.map((_, i) =>
        i < lesson.cursorProblem ? 'done' : i === lesson.cursorProblem ? 'current' : 'todo'
      ),
      subjectNames: lesson.subjectIds.map((id) => taxonomy.subjectById.get(id)?.name ?? id),
    }
  }

  async answer(lesson: Lesson, layerId: string, chosen: string) {
    const position = await this.openPosition(lesson, layerId)
    if (!position) return
    const outcome = this.grader.grade(this.question(position), chosen)
    if (!outcome) return
    await this.record(position, outcome, chosen)
  }

  async giveUp(lesson: Lesson, layerId: string) {
    const position = await this.openPosition(lesson, layerId)
    if (!position) return
    await this.record(position, 'gave_up', null)
  }

  /**
   * Records `skipped` for every layer of the current problem not answered
   * yet, then moves to the next problem without revealing anything.
   */
  async skip(lesson: Lesson) {
    const position = await this.position(lesson)
    if (!position) return
    const answered = new Set(position.attempts.map((a) => a.layerId))
    for (const step of position.steps) {
      if (!answered.has(step.id)) await this.record({ ...position, step }, 'skipped', null, false)
    }
    await this.advance(lesson, true)
  }

  /**
   * After feedback: next layer, next problem, or the end of the lesson.
   */
  async continue(lesson: Lesson) {
    const position = await this.position(lesson)
    if (!position) return
    const answered = position.attempts.some((a) => a.layerId === position.step.id)
    if (!answered) return
    const isLast = position.steps.indexOf(position.step) === position.steps.length - 1
    await this.advance(lesson, isLast)
  }

  async summary(lesson: Lesson): Promise<LessonSummary> {
    const [bundles, attempts] = await Promise.all([
      this.catalog.bundles(lesson.problemIds),
      Attempt.query().where('lesson_id', lesson.id).preload('layer'),
    ])

    const scores = new Map<string, LayerScore>()
    for (const attempt of attempts) {
      const kind = attempt.layer.kind
      const score = scores.get(kind) ?? { kind, label: labelFor(kind), right: 0, total: 0 }
      if (attempt.outcome !== 'skipped') {
        score.total++
        if (AnswerGrader.countsAsRight(attempt.outcome)) score.right++
      }
      scores.set(kind, score)
    }
    const kindOrder = Object.keys(KIND_LABELS)
    const rank = (kind: string) => (kindOrder.includes(kind) ? kindOrder.indexOf(kind) : 99)

    return {
      lesson,
      scores: [...scores.values()].sort((a, b) => rank(a.kind) - rank(b.kind)),
      problems: lesson.problemIds
        .map((id) => bundles.get(id))
        .filter((bundle) => bundle !== undefined)
        .map((bundle) => ({
          problem: bundle.problem,
          results: attempts
            .filter((a) => a.problemId === bundle.problem.id)
            .sort((a, b) => a.layer.position - b.layer.position)
            .map((a) => ({ label: labelFor(a.layer.kind), outcome: a.outcome })),
        })),
    }
  }

  protected question({ lesson, bundle, taxonomy, step, attempts }: Position): Question {
    const subjectAttempt = attempts.find((a) => a.layerId === `${bundle.problem.id}:subject`)
    return this.builder.build(step, {
      bundle,
      taxonomy,
      sessionSubjects: lesson.subjectIds,
      seed: `${lesson.id}:${step.id}`,
      subjectAnswer: subjectAttempt?.chosen ?? null,
    })
  }

  /**
   * Where the cursor points. Null when the lesson is done.
   */
  protected async position(lesson: Lesson): Promise<Position | null> {
    if (lesson.isDone) return null
    const problemId = lesson.problemIds[lesson.cursorProblem]
    if (!problemId) return null

    const [taxonomy, bundle, attempts] = await Promise.all([
      this.catalog.taxonomy(),
      this.catalog.bundle(problemId),
      Attempt.query().where('lesson_id', lesson.id).where('problem_id', problemId),
    ])
    const steps = this.builder.steps(bundle, lesson.subjectIds, taxonomy)
    // Content can change mid-lesson; never point past the last layer.
    const step = steps[Math.min(lesson.cursorLayer, steps.length - 1)]
    return { lesson, taxonomy, bundle, steps, step, attempts }
  }

  /**
   * The current position, only if `layerId` is the current layer and it
   * hasn't been answered yet.
   */
  protected async openPosition(lesson: Lesson, layerId: string) {
    const position = await this.position(lesson)
    if (!position || position.step.id !== layerId) return null
    if (position.attempts.some((a) => a.layerId === layerId)) return null
    return position
  }

  protected async record(
    { lesson, bundle, step }: Position,
    outcome: Outcome,
    chosen: string | null,
    timed = true
  ) {
    try {
      await Attempt.create({
        playerId: lesson.playerId,
        lessonId: lesson.id,
        layerId: step.id,
        problemId: bundle.problem.id,
        chosen,
        outcome,
        msTaken: timed ? Math.round(-lesson.layerStartedAt.diffNow().as('milliseconds')) : null,
      })
    } catch (error) {
      // Unique (lesson_id, layer_id): a concurrent submit already recorded it.
      if (!String((error as Error).message).includes('UNIQUE')) throw error
    }
  }

  protected async advance(lesson: Lesson, nextProblem: boolean) {
    if (nextProblem) {
      lesson.cursorProblem += 1
      lesson.cursorLayer = 0
    } else {
      lesson.cursorLayer += 1
    }
    lesson.layerStartedAt = DateTime.now()
    if (lesson.cursorProblem >= lesson.problemIds.length) {
      lesson.status = 'done'
      lesson.finishedAt = DateTime.now()
    }
    await lesson.save()
  }
}

function feedbackFor(question: Question, attempt: Attempt): Feedback {
  const picked = question.options.find((o) => o.id === attempt.chosen)
  return {
    outcome: attempt.outcome,
    options: question.options.map((option) => {
      const isPicked = option.id === attempt.chosen
      const mark =
        option.role === 'correct'
          ? 'right'
          : option.role === 'overkill'
            ? 'overkill'
            : isPicked
              ? 'picked-wrong'
              : 'none'
      return { id: option.id, text: option.text, mark, picked: isPicked }
    }),
    pickedWhy: picked?.why ?? null,
    expectedText: question.expected.text,
    explanation: question.explanation,
  }
}

function labelFor(kind: string) {
  return KIND_LABELS[kind] ?? kind.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}
