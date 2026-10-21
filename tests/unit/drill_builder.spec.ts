import { readFileSync } from 'node:fs'
import { test } from '@japa/runner'
import DrillBuilder, {
  FITS_RANGE_LOG10,
  MAX_N_SPREAD,
  fitsTable,
  isClear,
  largestFitting,
  log10Ops,
  opsLatex,
  type Drill,
} from '#services/drill_builder'
import { planItems } from '#services/drill_planner'
import { seededRandom } from '#services/random'
import type { BigOTableData } from '#types/drills'

const table: BigOTableData = JSON.parse(
  readFileSync(new URL('../fixtures/content/drills/big-o.json', import.meta.url), 'utf8')
)
const byId = (id: string) => table.complexities.find((c) => c.id === id)!
const builder = new DrillBuilder()
const SEEDS = Array.from({ length: 300 }, (_, i) => `1:drill:${i}`)

function build(kind: 'max-big-o' | 'max-n' | 'fits', seed: string): Drill {
  const drill = builder.build(kind, { table, seed })
  if (!drill) throw new Error(`no ${kind} drill for ${seed}`)
  return drill
}

test.group('Drill arithmetic', () => {
  test('counts operations in log10, so huge ones don’t overflow', ({ assert }) => {
    assert.closeTo(log10Ops('n3', 5000), Math.log10(1.25e11), 1e-9)
    assert.closeTo(log10Ops('n-fact', 10), Math.log10(3628800), 1e-9)
    assert.closeTo(log10Ops('2n', 100_000), 100_000 * Math.log10(2), 1e-6)
    assert.isFinite(log10Ops('n-fact', 1e12))
  })

  test('writes the calculation in LaTeX, exact or approximate', ({ assert }) => {
    assert.equal(opsLatex('n3', 5000), '5000^3 = 1.25 \\cdot 10^{11}')
    assert.equal(opsLatex('n2', 3000), '3000^2 = 9 \\cdot 10^{6}')
    assert.equal(opsLatex('n-2n', 15), '15 \\cdot 2^{15} \\approx 4.92 \\cdot 10^{5}')
    assert.equal(opsLatex('n-fact', 8), '8! = 40320')
    assert.equal(opsLatex('n', 1e9), '10^{9}')
    assert.equal(opsLatex('n2', 2e5), '(2 \\cdot 10^{5})^2 = 4 \\cdot 10^{10}')
  })

  test('a case is clear only when the table and the arithmetic agree with room', ({ assert }) => {
    // 500³ = 1.25·10⁸: the table says it fits, but it's right at the limit.
    assert.isTrue(fitsTable(byId('n3'), 500))
    assert.isFalse(isClear(table, byId('n3'), 500))
    assert.isTrue(isClear(table, byId('n3'), 300)) // 2.7·10⁷
    assert.isTrue(isClear(table, byId('n3'), 1000)) // 10⁹, doesn't fit
    // 3000² log 3000 ≈ 1.04·10⁸: over the table, but not clearly over.
    assert.isFalse(isClear(table, byId('n2-log-n'), 3000))
  })
})

test.group('DrillBuilder', () => {
  test('max-big-o: the answer is the largest complexity that fits, among clear options', ({
    assert,
  }) => {
    for (const seed of SEEDS) {
      const drill = build('max-big-o', seed)
      const n = drill.params.n as number
      assert.equal(drill.expected.id, largestFitting(table, n)!.id, seed)
      assert.lengthOf(drill.options, 4)
      for (const option of drill.options) assert.isTrue(isClear(table, byId(option.id), n), seed)
      // Listed in order of growth.
      const order = drill.options.map((o) => table.complexities.findIndex((c) => c.id === o.id))
      assert.deepEqual(
        order,
        [...order].sort((a, b) => a - b)
      )
    }
  })

  test('max-n: the answer is the threshold; the others are far from it', ({ assert }) => {
    for (const seed of SEEDS) {
      const drill = build('max-n', seed)
      const complexity = byId(drill.params.complexity as string)
      assert.equal(Number(drill.expected.id), complexity.maxN)
      assert.lengthOf(new Set(drill.options.map((o) => o.id)), 4)
      for (const option of drill.options.filter((o) => o.role === 'wrong')) {
        const v = Number(option.id)
        assert.isAtLeast(Math.max(v, complexity.maxN) / Math.min(v, complexity.maxN), MAX_N_SPREAD)
      }
    }
  })

  test('fits: a clear case near the budget, both verdicts about equally often', ({ assert }) => {
    let yes = 0
    for (const seed of SEEDS) {
      const drill = build('fits', seed)
      const complexity = byId(drill.params.complexity as string)
      const n = drill.params.n as number
      assert.isTrue(isClear(table, complexity, n))
      assert.isAtMost(Math.abs(log10Ops(complexity.id, n) - 8), FITS_RANGE_LOG10)
      assert.equal(drill.expected.id, fitsTable(complexity, n) ? 'yes' : 'no')
      if (drill.expected.id === 'yes') yes++
    }
    assert.isAbove(yes, SEEDS.length * 0.35)
    assert.isBelow(yes, SEEDS.length * 0.65)
  })

  test('explains with the arithmetic', ({ assert }) => {
    const drill = build('fits', 'explain')
    assert.property(drill.explanation, 'messages')
    if (!('messages' in drill.explanation)) return
    const [budget, verdict] = drill.explanation.messages
    assert.deepEqual(budget, {
      key: 'messages.drills.explain.budget',
      params: { ops: '$10^{8}$' },
    })
    assert.match(verdict.key, /^messages\.drills\.explain\.(fits|tooMany)$/)
    assert.match(verdict.params.calc, /^\$.+ (=|\\approx) .+\$$/)
  })

  test('algorithm-big-o: the authored complexity and its three wrong ones', ({ assert }) => {
    const algorithm = {
      id: 'graphs:bfs',
      data: {
        name: 'BFS',
        complexity: 'O(n + m)',
        wrong: ['O(n \\cdot m)', 'O(m \\log n)', 'O(n^2)'],
        explanation: 'Each vertex once.',
        explanationEs: 'Cada vértice una vez.',
      },
    }
    const drill = builder.build('algorithm-big-o', { table: null, algorithm, seed: 's' })!

    assert.deepEqual(
      drill.options.map((o) => o.id),
      ['a', 'b', 'c', 'd']
    )
    assert.equal(drill.expected.text, '$O(n + m)$')
    assert.deepEqual(drill.explanation, {
      text: 'Each vertex once.',
      textEs: 'Cada vértice una vez.',
    })
    assert.equal(drill.drillItemId, 'graphs:bfs')
  })

  test('the same seed gives the same drill; missing content gives none', ({ assert }) => {
    assert.deepEqual(build('max-big-o', 'same'), build('max-big-o', 'same'))
    assert.isNull(builder.build('fits', { table: null, seed: 'x' }))
    assert.isNull(builder.build('algorithm-big-o', { table, algorithm: null, seed: 'x' }))
  })
})

test.group('Drill planner', () => {
  const problems = ['p1', 'p2', 'p3', 'p4', 'p5']
  const kinds = (items: ReturnType<typeof planItems>) =>
    items.map((i) => (i.type === 'problem' ? i.id : i.kind))

  test('puts drills after the 1st, 3rd and 5th problems, one of each kind of question', ({
    assert,
  }) => {
    const items = planItems(
      problems,
      { generated: true, algorithms: ['graphs:bfs'] },
      seededRandom('a')
    )

    const shape = items.map((i) => (i.type === 'problem' ? 'P' : 'D')).join('')
    assert.equal(shape, 'PDPPDPPD')
    const drills = items.filter((i) => i.type === 'drill')
    assert.includeMembers(
      drills.map((d) => (d.kind === 'max-n' ? 'fits' : d.kind)),
      ['max-big-o', 'algorithm-big-o', 'fits']
    )
    assert.equal(drills.find((d) => d.kind === 'algorithm-big-o')?.algorithmId, 'graphs:bfs')
  })

  test('a shorter lesson gets fewer drills, at least one', ({ assert }) => {
    const available = { generated: true, algorithms: [] }
    assert.lengthOf(kinds(planItems(['p1'], available, seededRandom('b'))), 2)
    assert.lengthOf(kinds(planItems(['p1', 'p2', 'p3'], available, seededRandom('b'))), 5)
  })

  test('no algorithms: only generated drills; no table: only algorithms; nothing: none', ({
    assert,
  }) => {
    for (const seed of ['c', 'd', 'e', 'f']) {
      const generated = planItems(problems, { generated: true, algorithms: [] }, seededRandom(seed))
      assert.notInclude(kinds(generated), 'algorithm-big-o')
      assert.lengthOf(generated, 8)
    }
    const onlyAlgorithms = planItems(
      problems,
      { generated: false, algorithms: ['graphs:bfs', 'graphs:dijkstra-heap'] },
      seededRandom('g')
    )
    assert.deepEqual(
      onlyAlgorithms.filter((i) => i.type === 'drill').map((i) => i.type === 'drill' && i.kind),
      ['algorithm-big-o', 'algorithm-big-o']
    )
    assert.deepEqual(
      kinds(planItems(problems, { generated: false, algorithms: [] }, Math.random)),
      problems
    )
  })
})
