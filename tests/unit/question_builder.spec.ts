import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import AnswerGrader from '#services/answer_grader'
import Catalog, { type ProblemBundle, type Taxonomy } from '#services/catalog'
import QuestionBuilder, { type QuestionContext } from '#services/question_builder'
import { syncFixtureContent } from '#tests/helpers/content_fixture'

const SEEDS = Array.from({ length: 200 }, (_, i) => `seed-${i}`)

test.group('QuestionBuilder', (group) => {
  const builder = new QuestionBuilder()
  let taxonomy: Taxonomy
  let bundles: Map<string, ProblemBundle>

  group.setup(async () => {
    const truncate = await testUtils.db().truncate()
    await syncFixtureContent()
    const catalog = new Catalog()
    taxonomy = await catalog.taxonomy()
    bundles = await catalog.bundles(['fx-coins', 'fx-longest-path', 'fx-bfs', 'fx-lottery'])
    return truncate
  })

  const layer = (problemId: string, key: string) =>
    bundles.get(problemId)!.layers.find((l) => l.id === `${problemId}:${key}`)!

  const context = (problemId: string, extra: Partial<QuestionContext> = {}): QuestionContext => ({
    bundle: bundles.get(problemId)!,
    taxonomy,
    sessionSubjects: ['dp'],
    seed: 'seed',
    ...extra,
  })

  const stepKeys = (problemId: string, subjects: string[]) =>
    builder.steps(bundles.get(problemId)!, subjects, taxonomy).map((l) => l.id.split(':')[1])

  test('asks the subject layer only when the session has two or more subjects', ({ assert }) => {
    assert.deepEqual(stepKeys('fx-coins', ['dp']), ['technique', 'dp-state', 'dp-transition'])
    assert.deepEqual(stepKeys('fx-coins', ['dp', 'graphs']), [
      'subject',
      'technique',
      'dp-state',
      'dp-transition',
    ])
  })

  test("skips the intended subject's extra layers when only an accepted subject is selected", ({
    assert,
  }) => {
    assert.deepEqual(stepKeys('fx-longest-path', ['graphs']), ['technique'])
    assert.deepEqual(stepKeys('fx-longest-path', ['dp', 'graphs']), [
      'subject',
      'technique',
      'dp-state',
    ])
    // A distractor's intended subject is hidden, so its layers always play.
    assert.deepEqual(stepKeys('fx-lottery', ['dp']), ['technique'])
  })

  test('offers every visible subject plus "None of these" on the subject layer', ({ assert }) => {
    const question = builder.build(
      layer('fx-longest-path', 'subject'),
      context('fx-longest-path', { sessionSubjects: ['dp', 'graphs'] })
    )

    assert.deepEqual(
      question.options.map((o) => [o.id, o.role]),
      [
        ['dp', 'correct'],
        ['graphs', 'correct'],
        ['number-theory', 'correct'],
        ['other', 'wrong'],
      ]
    )
    assert.equal(question.expected.id, 'dp')
  })

  test('works in the accepted subject the player picked, if it has a technique', ({ assert }) => {
    const subjects = ['dp', 'graphs']
    const subjectOf = (answer: string | null) =>
      builder.techniqueSubject(
        context('fx-longest-path', { sessionSubjects: subjects, subjectAnswer: answer })
      )

    assert.equal(subjectOf('graphs'), 'graphs')
    assert.equal(subjectOf('dp'), 'dp')
    // Accepted, but the problem lists no number-theory technique.
    assert.equal(subjectOf('number-theory'), 'dp')
    // Wrong answers and give-ups continue in the intended subject.
    assert.equal(subjectOf('other'), 'dp')
    assert.equal(subjectOf(null), 'dp')
  })

  test('uses the session subject in a single-subject session that reached the problem through it', ({
    assert,
  }) => {
    const question = builder.build(
      layer('fx-longest-path', 'technique'),
      context('fx-longest-path', { sessionSubjects: ['graphs'] })
    )

    assert.equal(question.expected.id, 'graphs.toposort')
    assert.isFalse(question.options.some((o) => o.id === 'dp.dag' && o.role === 'wrong'))
  })

  test('has exactly one correct option and never marks an answer wrong', ({ assert }) => {
    for (const seed of SEEDS) {
      const question = builder.build(layer('fx-coins', 'technique'), context('fx-coins', { seed }))
      const correct = question.options.filter((o) => o.role === 'correct')

      assert.deepEqual(
        correct.map((o) => o.id),
        ['dp.coin-change']
      )
      // dp.linear is an accepted answer: never offered as a wrong option.
      assert.isFalse(question.options.some((o) => o.id === 'dp.linear'))
      assert.isAtMost(question.options.length, 4)
      assert.equal(new Set(question.options.map((o) => o.id)).size, question.options.length)
    }
  })

  test('puts problem distractors first among the wrong options', ({ assert }) => {
    for (const seed of SEEDS.slice(0, 20)) {
      const ids = builder
        .build(layer('fx-coins', 'technique'), context('fx-coins', { seed }))
        .options.map((o) => o.id)

      assert.include(ids, 'dp.knapsack-01')
      assert.include(ids, 'other.greedy')
    }
  })

  test('shows overkill techniques about half the time', ({ assert }) => {
    const shown = SEEDS.filter((seed) =>
      builder
        .build(
          layer('fx-bfs', 'technique'),
          context('fx-bfs', { sessionSubjects: ['graphs'], seed })
        )
        .options.some((o) => o.id === 'graphs.dijkstra' && o.role === 'overkill')
    ).length

    assert.isAbove(shown, SEEDS.length * 0.35)
    assert.isBelow(shown, SEEDS.length * 0.65)
  })

  test('sometimes, not always, offers greedy / ad hoc', ({ assert }) => {
    const withHatch = SEEDS.filter((seed) =>
      builder
        .build(
          layer('fx-bfs', 'technique'),
          context('fx-bfs', { sessionSubjects: ['graphs'], seed })
        )
        .options.some((o) => o.id.startsWith('other.'))
    ).length

    assert.isAbove(withHatch, 0)
    assert.isBelow(withHatch, SEEDS.length)
  })

  test('is deterministic for a seed and varies across seeds', ({ assert }) => {
    const order = (seed: string) =>
      builder
        .build(layer('fx-coins', 'dp-state'), context('fx-coins', { seed }))
        .options.map((o) => o.id)
        .join()

    assert.equal(order('a'), order('a'))
    assert.isAbove(new Set(SEEDS.slice(0, 20).map(order)).size, 1)
  })

  test('keeps authored options, roles and notes', ({ assert }) => {
    const question = builder.build(layer('fx-coins', 'dp-state'), context('fx-coins'))
    const b = question.options.find((o) => o.id === 'b')!

    assert.equal(question.expected.id, 'a')
    assert.equal(b.role, 'wrong')
    assert.equal(b.why, 'Loses the sum.')
    assert.equal(question.explanation, 'Only the remaining sum matters.')
  })
})

test.group('AnswerGrader', (group) => {
  const builder = new QuestionBuilder()
  const grader = new AnswerGrader()
  let bundles: Map<string, ProblemBundle>
  let taxonomy: Taxonomy

  group.setup(async () => {
    const truncate = await testUtils.db().truncate()
    await syncFixtureContent()
    const catalog = new Catalog()
    taxonomy = await catalog.taxonomy()
    bundles = await catalog.bundles(['fx-bfs', 'fx-coins'])
    return truncate
  })

  test('grades intended/accepted as correct, overkill as overkill, the rest as wrong', ({
    assert,
  }) => {
    const bundle = bundles.get('fx-bfs')!
    const technique = bundle.layers.find((l) => l.kind === 'technique')!
    // Find a seed where the overkill option is on screen.
    const question = SEEDS.map((seed) =>
      builder.build(technique, { bundle, taxonomy, sessionSubjects: ['graphs'], seed })
    ).find((q) => q.options.some((o) => o.role === 'overkill'))!
    const wrong = question.options.find((o) => o.role === 'wrong')!

    assert.equal(grader.grade(question, 'graphs.bfs'), 'correct')
    assert.equal(grader.grade(question, 'graphs.dijkstra'), 'overkill')
    assert.equal(grader.grade(question, wrong.id), 'wrong')
  })

  test('ignores options that were not offered', ({ assert }) => {
    const bundle = bundles.get('fx-coins')!
    const state = bundle.layers.find((l) => l.kind === 'dp-state')!
    const question = builder.build(state, {
      bundle,
      taxonomy,
      sessionSubjects: ['dp'],
      seed: 's',
    })

    assert.equal(grader.grade(question, 'a'), 'correct')
    assert.equal(grader.grade(question, 'b'), 'wrong')
    assert.isNull(grader.grade(question, 'z'))
  })

  test('counts overkill as right and gave_up as wrong in scores', ({ assert }) => {
    assert.isTrue(AnswerGrader.countsAsRight('correct'))
    assert.isTrue(AnswerGrader.countsAsRight('overkill'))
    assert.isFalse(AnswerGrader.countsAsRight('wrong'))
    assert.isFalse(AnswerGrader.countsAsRight('gave_up'))
  })
})
