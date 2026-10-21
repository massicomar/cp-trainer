import { seededRandom, shuffle, type Random } from '#services/random'
import type { Complexity, ComplexityId } from '#types/content'
import type { AlgorithmData, BigOTableData, DrillKind } from '#types/drills'

/**
 * Text the template translates: `t(key, params)`, then renders with `math()`.
 * Params carry the LaTeX ($…$), so the messages themselves have no braces.
 */
export interface DrillMessage {
  key: string
  params: Record<string, string>
}

export interface DrillOption {
  id: string
  /** LaTeX in $…$, or '' when `textKey` names a translated text ("Fits"). */
  text: string
  textKey?: string
  role: 'correct' | 'wrong'
}

export interface Drill {
  kind: DrillKind
  prompt: DrillMessage
  options: DrillOption[]
  expected: DrillOption
  /** Generated arithmetic, or the authored text of an algorithm drill. */
  explanation: { messages: DrillMessage[] } | { text: string; textEs: string | null }
  /** What was asked; stored with the attempt and put into reports. */
  params: Record<string, string | number | (string | number)[]>
  /** The algorithm's drill_items id; null for generated drills. */
  drillItemId: string | null
}

export interface DrillContext {
  /** The Big O table; generated kinds need it. */
  table: BigOTableData | null
  /** The algorithm of an `algorithm-big-o` drill. */
  algorithm?: { id: string; data: AlgorithmData } | null
  /** "<lessonId>:drill:<item index>": a reload shows the same drill. */
  seed: string
}

/**
 * A (complexity, n) case counts as clear when the table's verdict and the
 * arithmetic agree with this much room: fits → at most half the budget,
 * doesn't fit → at least twice the budget.
 */
export const CLEAR_MARGIN = 2
/** maxN at or above this means "any n" (O(1), O(log n)). */
export const UNLIMITED = 1e18
/** Wrong n values in `max-n` are at least this many times off the answer. */
export const MAX_N_SPREAD = 3
/**
 * `fits` asks about counts within 10^5 times the budget either way: O(n) with
 * n = 100 or 2^(10^12) teach nothing.
 */
export const FITS_RANGE_LOG10 = 5
const LOG10_2 = Math.log10(2)

/**
 * Builds drills (plan §6.9). Every generated case is clear: no question
 * hinges on whether 1.2·10⁸ operations fit.
 */
export default class DrillBuilder {
  /**
   * Null when the content the drill needs is missing (no Big O table, the
   * algorithm left the repo, or no clear case exists).
   */
  build(kind: DrillKind, context: DrillContext): Drill | null {
    const random = seededRandom(context.seed)
    if (kind === 'algorithm-big-o') {
      return context.algorithm ? algorithmDrill(context.algorithm, random) : null
    }
    if (!context.table) return null
    if (kind === 'max-big-o') return maxBigODrill(context.table, random)
    if (kind === 'max-n') return maxNDrill(context.table, random)
    return fitsDrill(context.table, random)
  }
}

/**
 * "With n ≤ X, what's the largest complexity that fits?" The four options
 * are listed in order of growth; every one of them is a clear case at X.
 */
function maxBigODrill(table: BigOTableData, random: Random): Drill | null {
  const order = (c: Complexity) => table.complexities.indexOf(c)
  for (const n of shuffle(table.nValues, random)) {
    const correct = largestFitting(table, n)
    if (!correct || !isClear(table, correct, n)) continue
    const others = table.complexities.filter((c) => c !== correct && isClear(table, c, n))
    if (others.length < 3) continue

    // The nearest larger and smaller ones make it a real choice; then any.
    const larger = others.filter((c) => order(c) > order(correct))
    const smaller = others.filter((c) => order(c) < order(correct)).reverse()
    const picked = [larger[0], smaller[0]].filter((c): c is Complexity => c !== undefined)
    const rest = shuffle(
      others.filter((c) => !picked.includes(c)),
      random
    )
    while (picked.length < 3) picked.push(rest.shift()!)

    const options = [correct, ...picked]
      .sort((a, b) => order(a) - order(b))
      .map((c) => complexityOption(c, c === correct))
    const nextLarger = picked
      .filter((c) => order(c) > order(correct))
      .sort((a, b) => order(a) - order(b))[0]
    return {
      kind: 'max-big-o',
      prompt: {
        key: 'messages.drills.prompts.max-big-o',
        params: { bound: `$n \\le ${formatN(n)}$` },
      },
      options,
      expected: options.find((o) => o.role === 'correct')!,
      explanation: {
        messages: [
          budget(table),
          describe(table, correct, n),
          ...(nextLarger ? [describe(table, nextLarger, n)] : []),
        ],
      },
      params: { n, options: options.map((o) => o.id) },
      drillItemId: null,
    }
  }
  return null
}

/**
 * "With O(f), up to roughly which n fits?" The options are thresholds and
 * n values, each at least MAX_N_SPREAD times off the answer.
 */
function maxNDrill(table: BigOTableData, random: Random): Drill | null {
  const limited = table.complexities.filter((c) => c.maxN < UNLIMITED)
  const values = [...new Set([...limited.map((c) => c.maxN), ...table.nValues])]
  const distance = (a: number, b: number) => Math.abs(Math.log10(a) - Math.log10(b))

  for (const complexity of shuffle(limited, random)) {
    const answer = complexity.maxN
    const far = values.filter((v) => distance(v, answer) >= Math.log10(MAX_N_SPREAD))
    if (far.length < 3) continue

    const above = far.filter((v) => v > answer).sort((a, b) => a - b)
    const below = far.filter((v) => v < answer).sort((a, b) => b - a)
    const picked = [above[0], below[0]].filter((v): v is number => v !== undefined)
    const rest = shuffle(
      far.filter((v) => !picked.includes(v)),
      random
    ).sort((a, b) => distance(a, answer) - distance(b, answer))
    while (picked.length < 3) picked.push(rest.shift()!)

    const options = [answer, ...picked]
      .sort((a, b) => a - b)
      .map((v) => ({
        id: String(v),
        text: `$${formatN(v)}$`,
        role: v === answer ? ('correct' as const) : ('wrong' as const),
      }))
    const nextAbove = picked.filter((v) => v > answer).sort((a, b) => a - b)[0]
    return {
      kind: 'max-n',
      prompt: {
        key: 'messages.drills.prompts.max-n',
        params: { complexity: `$${complexity.label}$` },
      },
      options,
      expected: options.find((o) => o.role === 'correct')!,
      explanation: {
        messages: [
          budget(table),
          describe(table, complexity, answer),
          ...(nextAbove ? [describe(table, complexity, nextAbove)] : []),
        ],
      },
      params: { complexity: complexity.id, options: options.map((o) => o.id) },
      drillItemId: null,
    }
  }
  return null
}

/**
 * "O(f) with n = X: does it fit?" Fits and doesn't fit come up about equally
 * often. O(1) and O(log n) always fit, so they're left out.
 */
function fitsDrill(table: BigOTableData, random: Random): Drill | null {
  const wanted = random() < 0.5
  const limit = Math.log10(table.opsPerSecond)
  const clear = table.complexities
    .filter((c) => c.maxN < UNLIMITED)
    .flatMap((c) => table.nValues.map((n) => ({ complexity: c, n })))
    .filter(({ complexity, n }) => isClear(table, complexity, n))
  const near = clear.filter(
    ({ complexity, n }) => Math.abs(log10Ops(complexity.id, n) - limit) <= FITS_RANGE_LOG10
  )
  const pool = near.length ? near : clear
  const withVerdict = (verdict: boolean) =>
    pool.filter(({ complexity, n }) => fitsTable(complexity, n) === verdict)
  const candidates = withVerdict(wanted).length ? withVerdict(wanted) : withVerdict(!wanted)
  if (!candidates.length) return null

  const { complexity, n } = candidates[Math.floor(random() * candidates.length)]
  const fits = fitsTable(complexity, n)
  const options: DrillOption[] = [
    { id: 'yes', text: '', textKey: 'messages.drills.fitsYes', role: fits ? 'correct' : 'wrong' },
    { id: 'no', text: '', textKey: 'messages.drills.fitsNo', role: fits ? 'wrong' : 'correct' },
  ]
  return {
    kind: 'fits',
    prompt: {
      key: 'messages.drills.prompts.fits',
      params: { complexity: `$${complexity.label}$`, bound: `$n = ${formatN(n)}$` },
    },
    options,
    expected: options.find((o) => o.role === 'correct')!,
    explanation: { messages: [budget(table), describe(table, complexity, n)] },
    params: { complexity: complexity.id, n },
    drillItemId: null,
  }
}

/**
 * "What's the time complexity of …?" The authored complexity and its three
 * wrong ones, shuffled; ids a–d follow the shuffled order.
 */
function algorithmDrill({ id, data }: { id: string; data: AlgorithmData }, random: Random): Drill {
  const shuffled = shuffle(
    [
      { latex: data.complexity, correct: true },
      ...data.wrong.map((latex) => ({ latex, correct: false })),
    ],
    random
  )
  const options = shuffled.map((o, i) => ({
    id: 'abcd'[i],
    text: `$${o.latex}$`,
    role: o.correct ? ('correct' as const) : ('wrong' as const),
  }))
  return {
    kind: 'algorithm-big-o',
    prompt: { key: 'messages.drills.prompts.algorithm-big-o', params: { name: data.name } },
    options,
    expected: options.find((o) => o.role === 'correct')!,
    explanation: { text: data.explanation, textEs: data.explanationEs },
    params: { algorithm: id },
    drillItemId: id,
  }
}

function complexityOption(c: Complexity, correct: boolean): DrillOption {
  return { id: c.id, text: `$${c.label}$`, role: correct ? 'correct' : 'wrong' }
}

/**
 * The fastest-growing complexity whose table limit still covers n. Limits
 * never grow along the list, so the ones that fit are a prefix.
 */
export function largestFitting(table: BigOTableData, n: number): Complexity | null {
  return table.complexities.filter((c) => fitsTable(c, n)).at(-1) ?? null
}

export function fitsTable(c: Complexity, n: number) {
  return n <= c.maxN
}

export function isClear(table: BigOTableData, c: Complexity, n: number) {
  const ops = log10Ops(c.id, n)
  const limit = Math.log10(table.opsPerSecond)
  const margin = Math.log10(CLEAR_MARGIN)
  return fitsTable(c, n) ? ops <= limit - margin : ops >= limit + margin
}

/**
 * log10 of the operation count, so 2^(10^5) and 10^12! don't overflow.
 */
export function log10Ops(id: ComplexityId, n: number): number {
  const log10n = Math.log10(n)
  const log10log2n = Math.log10(Math.max(Math.log2(n), 1))
  switch (id) {
    case '1':
      return 0
    case 'log-n':
      return log10log2n
    case 'n':
      return log10n
    case 'n-log-n':
      return log10n + log10log2n
    case 'n2':
      return 2 * log10n
    case 'n2-log-n':
      return 2 * log10n + log10log2n
    case 'n3':
      return 3 * log10n
    case '2n':
      return n * LOG10_2
    case 'n-2n':
      return log10n + n * LOG10_2
    case 'n-fact':
      return log10Factorial(n)
  }
}

function log10Factorial(n: number) {
  if (n <= 1000) {
    let sum = 0
    for (let k = 2; k <= n; k++) sum += Math.log10(k)
    return sum
  }
  // Stirling
  return n * Math.log10(n / Math.E) + 0.5 * Math.log10(2 * Math.PI * n)
}

/** The exact count when it's a small enough integer, else null. */
function exactOps(id: ComplexityId, n: number): number | null {
  const safe = (v: number) => (Number.isSafeInteger(v) ? v : null)
  switch (id) {
    case '1':
      return 1
    case 'n':
      return safe(n)
    case 'n2':
      return safe(n * n)
    case 'n3':
      return safe(n * n * n)
    case '2n':
      return n <= 52 ? 2 ** n : null
    case 'n-2n':
      return n <= 45 ? safe(n * 2 ** n) : null
    case 'n-fact': {
      if (n > 18) return null
      let f = 1
      for (let k = 2; k <= n; k++) f *= k
      return f
    }
    default:
      return null
  }
}

/**
 * n in LaTeX: 3000, 10^{5}, 2 \cdot 10^{5}.
 */
export function formatN(n: number): string {
  if (n < 1e5) return String(n)
  return scientific(Math.log10(n)).latex
}

/** 10^L as "m \cdot 10^{e}" with up to 3 significant digits. */
function scientific(log10: number): { latex: string; value: number } {
  let exponent = Math.floor(log10 + 1e-9)
  let mantissa = Math.round(10 ** (log10 - exponent) * 100) / 100
  if (mantissa >= 10) {
    mantissa = 1
    exponent += 1
  }
  const power = exponent > 1e6 ? `10^{${formatN(exponent)}}` : `10^{${exponent}}`
  return {
    latex: mantissa === 1 ? power : `${mantissa} \\cdot ${power}`,
    value: mantissa * 10 ** exponent,
  }
}

/**
 * "5000^3 = 1.25 \cdot 10^{11}", "15 \cdot 2^{15} = 491520", "2^{100} \approx 1.27 \cdot 10^{30}".
 */
export function opsLatex(id: ComplexityId, n: number): string {
  const x = formatN(n)
  const wrapped = /[\\^]/.test(x) ? `(${x})` : x
  const expression = {
    '1': '1',
    'log-n': `\\log_2 ${wrapped}`,
    'n': x,
    'n-log-n': `${x} \\cdot \\log_2 ${wrapped}`,
    'n2': `${wrapped}^2`,
    'n2-log-n': `${wrapped}^2 \\cdot \\log_2 ${wrapped}`,
    'n3': `${wrapped}^3`,
    '2n': `2^{${x}}`,
    'n-2n': `${x} \\cdot 2^{${x}}`,
    'n-fact': `${wrapped}!`,
  }[id]

  const exact = exactOps(id, n)
  let value: string
  let approx: boolean
  if (exact !== null && exact < 1e5) {
    value = String(exact)
    approx = false
  } else {
    const log10 = log10Ops(id, n)
    if (log10 < 5) {
      value = String(Math.round(10 ** log10))
      approx = true
    } else {
      const s = scientific(log10)
      value = s.latex
      approx = exact === null || s.value !== exact
    }
  }
  if (expression === value) return value
  return `${expression} ${approx ? '\\approx' : '='} ${value}`
}

function budget(table: BigOTableData): DrillMessage {
  return {
    key: 'messages.drills.explain.budget',
    params: { ops: `$${formatN(table.opsPerSecond)}$` },
  }
}

/**
 * One sentence of arithmetic: fits, about the limit, or far too many.
 */
function describe(table: BigOTableData, c: Complexity, n: number): DrillMessage {
  const ops = log10Ops(c.id, n)
  const limit = Math.log10(table.opsPerSecond)
  const margin = Math.log10(CLEAR_MARGIN)
  const key = ops <= limit - margin ? 'fits' : ops >= limit + margin ? 'tooMany' : 'aboutTheLimit'
  return {
    key: `messages.drills.explain.${key}`,
    params: {
      bound: `$n = ${formatN(n)}$`,
      complexity: `$${c.label}$`,
      calc: `$${opsLatex(c.id, n)}$`,
    },
  }
}
