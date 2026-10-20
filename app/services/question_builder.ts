import type Layer from '#models/layer'
import type { ProblemBundle, Taxonomy } from '#services/catalog'
import { seededRandom, shuffle, type Random } from '#services/random'
import type { OptionRole } from '#types/play'

export interface QuestionOption {
  id: string
  text: string
  /** Authored note shown after picking this option (extra layers only). */
  why?: string
  role: OptionRole
}

export interface Question {
  layer: Layer
  prompt: string
  options: QuestionOption[]
  /** The expected answer, named in the "works, but…" feedback for overkill picks. */
  expected: QuestionOption
  explanation: string | null
}

export interface QuestionContext {
  bundle: ProblemBundle
  taxonomy: Taxonomy
  /** The lesson's selected subjects. */
  sessionSubjects: string[]
  /** "<lessonId>:<layerId>": same seed, same options in the same order. */
  seed: string
  /** What the player picked on this problem's subject layer; null if not asked or given up. */
  subjectAnswer?: string | null
}

/** Wrong options next to the expected technique (4 options in total). */
export const WRONG_TECHNIQUES = 3
/** Chance that each overkill technique takes one of the wrong-option slots. */
export const OVERKILL_CHANCE = 0.5
/**
 * Chance that greedy / ad hoc takes a wrong slot when no distractor already
 * put one there. Any problem with small enough limits might look brute-forceable,
 * so they should keep showing up everywhere, just not on every question.
 */
export const ESCAPE_HATCH_CHANCE = 1 / 3

/**
 * Turns a problem's layers into the questions a player sees.
 *
 * - Layer 1 (subject): asked only when the session has 2+ subjects. Options
 *   are every visible subject plus "None of these", in taxonomy order.
 * - Layer 2 (technique): the expected technique of the subject the player is
 *   working in, plus distractors (see `techniqueQuestion`), shuffled.
 * - Layers 3+ (authored): asked when the problem's intended subject is part
 *   of the session (or is hidden, as for distractors). Options shuffled.
 */
export default class QuestionBuilder {
  /**
   * The layers this session asks for a problem, in order.
   */
  steps(bundle: ProblemBundle, sessionSubjects: string[], taxonomy: Taxonomy): Layer[] {
    const intended = intendedSubject(bundle)
    const intendedHidden = taxonomy.subjectById.get(intended)?.hidden ?? false
    const askSubject = sessionSubjects.length >= 2
    const askExtra = sessionSubjects.includes(intended) || intendedHidden

    return bundle.layers.filter((layer) => {
      if (layer.kind === 'subject') return askSubject
      if (layer.kind === 'technique') return true
      return askExtra
    })
  }

  build(layer: Layer, context: QuestionContext): Question {
    if (layer.kind === 'subject') return this.subjectQuestion(layer, context)
    if (layer.kind === 'technique') return this.techniqueQuestion(layer, context)
    return this.authoredQuestion(layer, context)
  }

  /**
   * Which subject's techniques the technique layer is about:
   * - after a subject layer: the subject the player picked, if it's an
   *   accepted subject the problem lists a technique for; otherwise the
   *   intended subject (wrong answers and give-ups continue in the right one);
   * - in a single-subject session: that subject, if the problem is in the
   *   session as an accepted subject with its own technique; otherwise the
   *   intended subject.
   */
  techniqueSubject(context: QuestionContext): string {
    const { bundle, taxonomy, sessionSubjects } = context
    const intended = intendedSubject(bundle)
    const candidate =
      sessionSubjects.length >= 2 ? (context.subjectAnswer ?? null) : sessionSubjects[0]

    if (!candidate || candidate === intended) return intended
    const isAccepted = bundle.answers.some(
      (a) => a.kind === 'subject' && a.id === candidate && a.role === 'accepted'
    )
    const hasTechnique = bundle.answers.some(
      (a) => a.kind === 'technique' && taxonomy.techniqueById.get(a.id)?.subjectId === candidate
    )
    return isAccepted && hasTechnique ? candidate : intended
  }

  protected subjectQuestion(layer: Layer, { bundle, taxonomy }: QuestionContext): Question {
    const roles = rolesOf(bundle, 'subject')
    const options = taxonomy.subjects.map((subject) => ({
      id: subject.id,
      text: subject.name,
      role: optionRole(roles.get(subject.id)),
    }))
    return {
      layer,
      prompt: layer.prompt,
      options,
      expected: options.find((o) => o.id === intendedSubject(bundle))!,
      explanation: layer.explanationMd,
    }
  }

  /**
   * The expected technique, then up to 3 wrong ones picked in this order:
   * the problem's `distractors` (any subject), the expected technique's
   * `confusableWith`, then other techniques of the same subject at random.
   * Correct answers (intended / accepted / overkill) are never wrong options.
   *
   * Two seeded adjustments then may take a wrong slot:
   * - each overkill technique, with OVERKILL_CHANCE;
   * - greedy / ad hoc (techniques of hidden subjects), with
   *   ESCAPE_HATCH_CHANCE, unless one is already there.
   */
  protected techniqueQuestion(layer: Layer, context: QuestionContext): Question {
    const { bundle, taxonomy } = context
    const random = seededRandom(context.seed)
    const roles = rolesOf(bundle, 'technique')
    const subjectId = this.techniqueSubject(context)
    const subjectOf = (id: string) => taxonomy.techniqueById.get(id)?.subjectId

    const techniqueAnswers = bundle.answers.filter((a) => a.kind === 'technique')
    const expectedId =
      techniqueAnswers.find((a) => a.role === 'intended' && subjectOf(a.id) === subjectId)?.id ??
      techniqueAnswers.find((a) => a.role === 'accepted' && subjectOf(a.id) === subjectId)?.id ??
      techniqueAnswers.find((a) => a.role === 'intended')!.id
    const expected = taxonomy.techniqueById.get(expectedId)

    const overkill = techniqueAnswers
      .filter(
        (a) => a.role === 'overkill' && a.id !== expectedId && taxonomy.techniqueById.has(a.id)
      )
      .map((a) => a.id)
      .filter(() => random() < OVERKILL_CHANCE)

    const isWrong = (id: string) => taxonomy.techniqueById.has(id) && !roles.has(id)
    const sameSubject = taxonomy.techniques
      .filter((t) => t.subjectId === subjectId)
      .map((t) => t.id)
    const pool = unique([
      ...bundle.problem.distractors,
      ...(expected?.confusableWith ?? []),
      ...shuffle(sameSubject, random),
    ]).filter(isWrong)

    const slots = Math.max(0, WRONG_TECHNIQUES - overkill.length)
    let wrong = pool.slice(0, slots)
    wrong = withEscapeHatch(wrong, slots, taxonomy, isWrong, random)

    const option = (id: string) => ({
      id,
      text: taxonomy.techniqueById.get(id)?.name ?? id,
      role: optionRole(roles.get(id)),
    })
    const expectedOption = option(expectedId)
    return {
      layer,
      prompt: layer.prompt,
      options: shuffle([expectedOption, ...overkill.map(option), ...wrong.map(option)], random),
      expected: expectedOption,
      explanation: layer.explanationMd,
    }
  }

  protected authoredQuestion(layer: Layer, context: QuestionContext): Question {
    const random = seededRandom(context.seed)
    const options = (layer.options ?? []).map((o) => ({
      id: o.id,
      text: o.text,
      why: o.why,
      role: (layer.accepted.includes(o.id) ? 'correct' : 'wrong') as OptionRole,
    }))
    return {
      layer,
      prompt: layer.prompt,
      options: shuffle(options, random),
      expected: options.find((o) => o.role === 'correct')!,
      explanation: layer.explanationMd,
    }
  }
}

export function intendedSubject(bundle: ProblemBundle) {
  return bundle.answers.find((a) => a.kind === 'subject' && a.role === 'intended')!.id
}

function rolesOf(bundle: ProblemBundle, kind: 'subject' | 'technique') {
  return new Map(bundle.answers.filter((a) => a.kind === kind).map((a) => [a.id, a.role]))
}

function optionRole(role: string | undefined): OptionRole {
  if (role === 'intended' || role === 'accepted') return 'correct'
  if (role === 'overkill') return 'overkill'
  return 'wrong'
}

function unique<T>(items: T[]) {
  return [...new Set(items)]
}

/**
 * Maybe puts greedy or ad hoc into the wrong options (replacing the last one
 * when they're full), unless one is already there.
 */
function withEscapeHatch(
  wrong: string[],
  slots: number,
  taxonomy: Taxonomy,
  isWrong: (id: string) => boolean,
  random: Random
) {
  const hatch = taxonomy.techniques
    .filter((t) => taxonomy.subjectById.get(t.subjectId)?.hidden && isWrong(t.id))
    .map((t) => t.id)
  if (!slots || !hatch.length || wrong.some((id) => hatch.includes(id))) return wrong
  if (random() >= ESCAPE_HATCH_CHANCE) return wrong

  const pick = hatch[Math.floor(random() * hatch.length)]
  return wrong.length < slots ? [...wrong, pick] : [...wrong.slice(0, slots - 1), pick]
}
