import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import Attempt from '#models/attempt'
import DrillAttempt from '#models/drill_attempt'
import Lesson from '#models/lesson'
import type Player from '#models/player'
import type Problem from '#models/problem'
import AnswerGrader from '#services/answer_grader'
import Catalog, { type ProblemBundle, type Taxonomy } from '#services/catalog'
import DrillBuilder, { type Drill } from '#services/drill_builder'
import DrillCatalog from '#services/drill_catalog'
import DrillPlanner, { planItems } from '#services/drill_planner'
import LessonPlanner from '#services/lesson_planner'
import type { ReportTarget } from '#services/problem_reports'
import QuestionBuilder, { type Question } from '#services/question_builder'
import { DRILL_KINDS, type LessonItem } from '#types/drills'
import type { Outcome, Selection } from '#types/play'

/**
 * What the lesson page shows right now, problem or drill: a question, or
 * (once `attempt` is set) the feedback for it.
 */
interface PlayBase {
  lesson: Lesson
  /**
   * Identifies the current question in forms ("<item index>.<step index>").
   * Opaque on purpose: layer ids contain the problem id, which would let a
   * player look the original up from the page source.
   */
  stepToken: string
  /** One entry per item of the lesson, drills marked. */
  progress: { state: 'done' | 'current' | 'todo'; drill: boolean }[]
  problemCount: number
  subjectNames: string[]
  isLastItem: boolean
  /** What the button after the feedback says. */
  next: 'continue' | 'nextProblem' | 'seeResults'
}

export interface ProblemPlay extends PlayBase {
  type: 'problem'
  problem: Problem
  problemNumber: number
  stepNumber: number
  stepCount: number
  question: Question
  /** Set once the current layer is answered: the page shows feedback. */
  attempt: Attempt | null
  feedback: Feedback | null
  /** The problem's last layer: its feedback also reveals the title, link and traps. */
  isLastStep: boolean
}

export interface DrillPlay extends PlayBase {
  type: 'drill'
  drill: Drill
  attempt: DrillAttempt | null
  feedback: DrillFeedback | null
}

export type PlayState = ProblemPlay | DrillPlay

type Mark = 'right' | 'overkill' | 'picked-wrong' | 'none'

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
    mark: Mark
    picked: boolean
  }[]
  /** The authored note on the picked option, if any. */
  pickedWhy: string | null
  pickedWhyEs: string | null
  expectedText: string
  explanation: string | null
  explanationEs: string | null
}

export interface DrillFeedback {
  outcome: Outcome
  options: { id: string; text: string; textKey?: string; mark: Mark; picked: boolean }[]
}

export interface LayerScore {
  kind: string
  label: string
  right: number
  total: number
}

export interface LessonSummary {
  lesson: Lesson
  /** Problem layers first, then one line per drill kind. */
  scores: LayerScore[]
  problems: {
    problem: Problem
    results: { kind: string; label: string; outcome: Outcome }[]
  }[]
}

interface ProblemPosition {
  type: 'problem'
  lesson: Lesson
  itemIndex: number
  taxonomy: Taxonomy
  bundle: ProblemBundle
  steps: ProblemBundle['layers']
  step: ProblemBundle['layers'][number]
  attempts: Attempt[]
}

interface DrillPosition {
  type: 'drill'
  lesson: Lesson
  itemIndex: number
  drill: Drill
  attempt: DrillAttempt | null
}

type Position = ProblemPosition | DrillPosition

const KIND_LABELS: Record<string, string> = {
  'subject': 'Subject',
  'technique': 'Technique',
  'dp-state': 'DP state',
  'dp-transition': 'DP transition',
  'complexity': 'Complexity',
  'observation': 'Observation',
  'node-stores': 'Node contents',
  'trap': 'Trap',
  'max-big-o': 'Largest complexity for a bound',
  'algorithm-big-o': 'Complexity of an algorithm',
  'max-n': 'Largest n for a complexity',
  'fits': 'Fits or not',
}

/**
 * The lesson state machine. The cursor (item index, layer index) is stored
 * on the lesson row; whether the current question was answered is derived
 * from its attempt. Requests that don't match the current state (a stale
 * tab, a double click) are ignored, so the caller can always just re-render.
 */
@inject()
export default class LessonFlow {
  constructor(
    protected catalog: Catalog,
    protected builder: QuestionBuilder,
    protected grader: AnswerGrader,
    protected planner: LessonPlanner,
    protected drillCatalog: DrillCatalog,
    protected drillPlanner: DrillPlanner,
    protected drillBuilder: DrillBuilder
  ) {}

  /**
   * Null when nothing matches the selection.
   */
  async create(player: Player, selection: Selection): Promise<Lesson | null> {
    const problemIds = await this.planner.plan(player.id, selection)
    if (!problemIds.length) return null

    player.preferences = selection
    await player.save()

    const items: LessonItem[] = selection.includeDrills
      ? planItems(problemIds, await this.drillPlanner.availability(selection.subjects), Math.random)
      : problemIds.map((id) => ({ type: 'problem', id }))

    return Lesson.create({
      playerId: player.id,
      subjectIds: selection.subjects,
      tiers: selection.tiers,
      includeCommunity: selection.includeCommunity,
      includeDrills: selection.includeDrills,
      problemIds,
      items,
      cursorItem: 0,
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

    const taxonomy = position.type === 'problem' ? position.taxonomy : await this.catalog.taxonomy()
    const cursor = lesson.cursorItem
    const isLastItem = cursor === lesson.items.length - 1
    const nextIsProblem = lesson.items[cursor + 1]?.type === 'problem'
    const base = {
      lesson,
      stepToken: stepToken(position),
      progress: lesson.items.map((item, i) => ({
        state:
          i < cursor ? ('done' as const) : i === cursor ? ('current' as const) : ('todo' as const),
        drill: item.type === 'drill',
      })),
      problemCount: lesson.problemIds.length,
      subjectNames: lesson.subjectIds.map((id) => taxonomy.subjectById.get(id)?.name ?? id),
      isLastItem,
    }
    const after = isLastItem ? 'seeResults' : nextIsProblem ? 'nextProblem' : 'continue'

    if (position.type === 'drill') {
      return {
        ...base,
        type: 'drill',
        next: after,
        drill: position.drill,
        attempt: position.attempt,
        feedback: position.attempt ? drillFeedbackFor(position.drill, position.attempt) : null,
      }
    }

    const { bundle, steps, step, attempts } = position
    const stepIndex = steps.indexOf(step)
    const question = this.question(position)
    const attempt = attempts.find((a) => a.layerId === step.id) ?? null
    const isLastStep = stepIndex === steps.length - 1
    return {
      ...base,
      type: 'problem',
      next: isLastStep ? after : 'continue',
      problem: bundle.problem,
      problemNumber: lesson.items.slice(0, cursor + 1).filter((i) => i.type === 'problem').length,
      stepNumber: stepIndex + 1,
      stepCount: steps.length,
      question,
      attempt,
      feedback: attempt ? feedbackFor(question, attempt) : null,
      isLastStep,
    }
  }

  async answer(lesson: Lesson, step: string, chosen: string) {
    const position = await this.openPosition(lesson, step)
    if (!position) return
    if (position.type === 'drill') {
      const option = position.drill.options.find((o) => o.id === chosen)
      if (!option) return
      await this.recordDrill(position, option.role === 'correct' ? 'correct' : 'wrong', chosen)
      return
    }
    const outcome = this.grader.grade(this.question(position), chosen)
    if (!outcome) return
    await this.record(position, outcome, chosen)
  }

  async giveUp(lesson: Lesson, step: string) {
    const position = await this.openPosition(lesson, step)
    if (!position) return
    if (position.type === 'drill') await this.recordDrill(position, 'gave_up', null)
    else await this.record(position, 'gave_up', null)
  }

  /**
   * Records `skipped` for every question of the current item not answered
   * yet, then moves to the next item without revealing anything.
   */
  async skip(lesson: Lesson) {
    const position = await this.position(lesson)
    if (!position) return
    if (position.type === 'drill') {
      if (!position.attempt) await this.recordDrill(position, 'skipped', null, false)
    } else {
      const answered = new Set(position.attempts.map((a) => a.layerId))
      for (const step of position.steps) {
        if (!answered.has(step.id)) await this.record({ ...position, step }, 'skipped', null, false)
      }
    }
    await this.advance(lesson, true)
  }

  /**
   * After feedback: next layer, next item, or the end of the lesson.
   */
  async continue(lesson: Lesson) {
    const position = await this.position(lesson)
    if (!position) return
    if (position.type === 'drill') {
      if (position.attempt) await this.advance(lesson, true)
      return
    }
    const answered = position.attempts.some((a) => a.layerId === position.step.id)
    if (!answered) return
    const isLast = position.steps.indexOf(position.step) === position.steps.length - 1
    await this.advance(lesson, isLast)
  }

  async summary(lesson: Lesson): Promise<LessonSummary> {
    const [bundles, attempts, drillAttempts] = await Promise.all([
      this.catalog.bundles(lesson.problemIds),
      Attempt.query().where('lesson_id', lesson.id).preload('layer'),
      DrillAttempt.query().where('lesson_id', lesson.id).orderBy('item_index'),
    ])

    const scores = new Map<string, LayerScore>()
    const count = (kind: string, outcome: Outcome) => {
      const score = scores.get(kind) ?? { kind, label: labelFor(kind), right: 0, total: 0 }
      if (outcome !== 'skipped') {
        score.total++
        if (AnswerGrader.countsAsRight(outcome)) score.right++
      }
      scores.set(kind, score)
    }
    for (const attempt of attempts) count(attempt.layer.kind, attempt.outcome)
    for (const attempt of drillAttempts) count(attempt.kind, attempt.outcome)

    const kindOrder = Object.keys(KIND_LABELS)
    const drillKinds: readonly string[] = DRILL_KINDS
    // Known layer kinds, then custom ones, then the drills.
    const rank = (kind: string) =>
      drillKinds.includes(kind)
        ? 200 + drillKinds.indexOf(kind)
        : kindOrder.includes(kind)
          ? kindOrder.indexOf(kind)
          : 99

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
            .map((a) => ({
              kind: a.layer.kind,
              label: labelFor(a.layer.kind),
              outcome: a.outcome,
            })),
        })),
    }
  }

  /**
   * What a "Report a problem" link points at: `step` ("<item>.<step>", from
   * the lesson page) or `problem` (an index into the lesson's problems, from
   * the summary). Only items the player has reached, so the redirect can't be
   * used to peek at the ids of problems still to come.
   */
  async reportTarget(
    lesson: Lesson,
    input: { step?: unknown; problem?: unknown }
  ): Promise<ReportTarget | null> {
    const reached = (itemIndex: number) =>
      itemIndex >= 0 && (lesson.isDone || itemIndex <= lesson.cursorItem)

    if (typeof input.step !== 'string') {
      const problemIndex = Number(input.problem)
      const problemId = Number.isInteger(problemIndex) ? lesson.problemIds[problemIndex] : undefined
      if (!problemId) return null
      const itemIndex = lesson.items.findIndex((i) => i.type === 'problem' && i.id === problemId)
      return reached(itemIndex) ? { type: 'problem', problemId, layer: null } : null
    }

    const [itemIndex, stepIndex] = input.step.split('.').map(Number)
    const item = Number.isInteger(itemIndex) ? lesson.items[itemIndex] : undefined
    if (!item || !reached(itemIndex)) return null

    if (item.type === 'drill') {
      const drill = await this.drill(lesson, itemIndex)
      if (!drill) return null
      return {
        type: 'drill',
        kind: drill.kind,
        source: drill.drillItemId
          ? `drills/${drill.drillItemId.replace(':', '.json → ')}`
          : 'drills/big-o.json',
        params: drill.params,
      }
    }

    const problemId = item.id
    if (!Number.isInteger(stepIndex)) return { type: 'problem', problemId, layer: null }
    const [taxonomy, bundle] = await Promise.all([
      this.catalog.taxonomy(),
      this.catalog.bundle(problemId),
    ])
    const layer = this.builder.steps(bundle, lesson.subjectIds, taxonomy)[stepIndex]
    return {
      type: 'problem',
      problemId,
      layer: layer ? layer.id.slice(problemId.length + 1) : null,
    }
  }

  protected question({ lesson, bundle, taxonomy, step, attempts }: ProblemPosition): Question {
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
   * The drill at an item, rebuilt from its seed. Null when its content is gone.
   */
  protected async drill(lesson: Lesson, itemIndex: number): Promise<Drill | null> {
    const item = lesson.items[itemIndex]
    if (item?.type !== 'drill') return null
    const [table, algorithm] = await Promise.all([
      item.kind === 'algorithm-big-o' ? null : this.drillCatalog.table(),
      item.algorithmId ? this.drillCatalog.algorithm(item.algorithmId) : null,
    ])
    return this.drillBuilder.build(item.kind, {
      table,
      algorithm,
      seed: `${lesson.id}:drill:${itemIndex}`,
    })
  }

  /**
   * Where the cursor points. Null when the lesson is done. A drill whose
   * content left the repo is passed over.
   */
  protected async position(lesson: Lesson): Promise<Position | null> {
    while (!lesson.isDone) {
      const itemIndex = lesson.cursorItem
      const item = lesson.items[itemIndex]
      if (!item) return null

      if (item.type === 'problem') {
        const [taxonomy, bundle, attempts] = await Promise.all([
          this.catalog.taxonomy(),
          this.catalog.bundle(item.id),
          Attempt.query().where('lesson_id', lesson.id).where('problem_id', item.id),
        ])
        const steps = this.builder.steps(bundle, lesson.subjectIds, taxonomy)
        // Content can change mid-lesson; never point past the last layer.
        const step = steps[Math.min(lesson.cursorLayer, steps.length - 1)]
        return { type: 'problem', lesson, itemIndex, taxonomy, bundle, steps, step, attempts }
      }

      const drill = await this.drill(lesson, itemIndex)
      if (drill) {
        const attempt = await DrillAttempt.query()
          .where('lesson_id', lesson.id)
          .where('item_index', itemIndex)
          .first()
        return { type: 'drill', lesson, itemIndex, drill, attempt }
      }
      await this.advance(lesson, true)
    }
    return null
  }

  /**
   * The current position, only if `token` names the current question and it
   * hasn't been answered yet.
   */
  protected async openPosition(lesson: Lesson, token: string) {
    const position = await this.position(lesson)
    if (!position || stepToken(position) !== token) return null
    if (position.type === 'drill') return position.attempt ? null : position
    if (position.attempts.some((a) => a.layerId === position.step.id)) return null
    return position
  }

  protected async record(
    { lesson, bundle, step }: ProblemPosition,
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
        msTaken: timed ? msSince(lesson) : null,
      })
    } catch (error) {
      // Unique (lesson_id, layer_id): a concurrent submit already recorded it.
      if (!String((error as Error).message).includes('UNIQUE')) throw error
    }
  }

  protected async recordDrill(
    { lesson, itemIndex, drill }: DrillPosition,
    outcome: Outcome,
    chosen: string | null,
    timed = true
  ) {
    try {
      await DrillAttempt.create({
        playerId: lesson.playerId,
        lessonId: lesson.id,
        itemIndex,
        kind: drill.kind,
        drillItemId: drill.drillItemId,
        params: drill.params,
        answer: drill.expected.id,
        chosen,
        outcome,
        msTaken: timed ? msSince(lesson) : null,
      })
    } catch (error) {
      // Unique (lesson_id, item_index): a concurrent submit already recorded it.
      if (!String((error as Error).message).includes('UNIQUE')) throw error
    }
  }

  protected async advance(lesson: Lesson, nextItem: boolean) {
    if (nextItem) {
      lesson.cursorItem += 1
      lesson.cursorLayer = 0
    } else {
      lesson.cursorLayer += 1
    }
    lesson.layerStartedAt = DateTime.now()
    if (lesson.cursorItem >= lesson.items.length) {
      lesson.status = 'done'
      lesson.finishedAt = DateTime.now()
    }
    await lesson.save()
  }
}

function msSince(lesson: Lesson) {
  return Math.round(-lesson.layerStartedAt.diffNow().as('milliseconds'))
}

function stepToken(position: Position) {
  const step = position.type === 'problem' ? position.steps.indexOf(position.step) : 0
  return `${position.itemIndex}.${step}`
}

function mark(role: string, isPicked: boolean): Mark {
  if (role === 'correct') return 'right'
  if (role === 'overkill') return 'overkill'
  return isPicked ? 'picked-wrong' : 'none'
}

function feedbackFor(question: Question, attempt: Attempt): Feedback {
  const picked = question.options.find((o) => o.id === attempt.chosen)
  return {
    outcome: attempt.outcome,
    options: question.options.map((option) => {
      const isPicked = option.id === attempt.chosen
      return {
        id: option.id,
        text: option.text,
        mark: mark(option.role, isPicked),
        picked: isPicked,
      }
    }),
    pickedWhy: picked?.why ?? null,
    pickedWhyEs: picked?.whyEs ?? null,
    expectedText: question.expected.text,
    explanation: question.explanation,
    explanationEs: question.explanationEs,
  }
}

function drillFeedbackFor(drill: Drill, attempt: DrillAttempt): DrillFeedback {
  return {
    outcome: attempt.outcome,
    options: drill.options.map((option) => {
      const isPicked = option.id === attempt.chosen
      return {
        id: option.id,
        text: option.text,
        textKey: option.textKey,
        mark: mark(option.role, isPicked),
        picked: isPicked,
      }
    }),
  }
}

function labelFor(kind: string) {
  return KIND_LABELS[kind] ?? kind.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}
