import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import Layer from '#models/layer'
import Problem from '#models/problem'
import Subject from '#models/subject'
import Technique from '#models/technique'
import ContentSync, { type SyncReport } from '#services/content_sync'
import { ContentFixture } from '#tests/helpers/content_fixture'

const BFS = 'problems/graphs/fx-bfs.json'
const COINS = 'problems/dp/fx-coins.json'

test.group('ContentSync', (group) => {
  let fixture: ContentFixture

  async function trySync() {
    const contentSync = await app.container.make(ContentSync)
    return contentSync.syncDirectory(fixture.dir)
  }

  async function sync(): Promise<SyncReport> {
    const result = await trySync()
    if (!result.ok) throw new Error(result.errors.map((e) => `${e.file}: ${e.message}`).join('\n'))
    return result.report
  }

  async function isDeprecated(model: typeof Problem | typeof Layer, id: string) {
    const row = await model.findOrFail(id)
    return row.deprecated
  }

  group.each.setup(async () => {
    fixture = await ContentFixture.create()
    const truncate = await testUtils.db().truncate()
    return async () => {
      await truncate()
      await fixture.cleanup()
    }
  })

  test('copies the taxonomy', async ({ assert }) => {
    await sync()

    const subjects = await Subject.query().orderBy('position')
    assert.deepEqual(
      subjects.map((s) => s.id),
      ['dp', 'graphs', 'number-theory', 'other']
    )
    assert.strictEqual(subjects[3].hidden, true)
    assert.strictEqual(subjects[0].hidden, false)

    const techniques = await Technique.all()
    assert.lengthOf(techniques, 10)
    const linear = techniques.find((t) => t.id === 'dp.linear')!
    assert.equal(linear.subjectId, 'dp')
    assert.deepEqual(linear.confusableWith, ['dp.coin-change', 'other.greedy'])
  })

  test('copies problems with their layers in order', async ({ assert }) => {
    const report = await sync()
    assert.deepInclude(report.problems, { total: 4, ready: 3, draft: 1, added: 4 })

    const coins = await Problem.query().where('id', 'fx-coins').preload('layers').firstOrFail()
    assert.equal(coins.status, 'ready')
    assert.equal(coins.tier, 'easy')
    assert.equal(coins.sourcePath, COINS)
    assert.strictEqual(coins.constraintsVerified, true)
    assert.strictEqual(coins.deprecated, false)
    assert.deepEqual(coins.pairWith, ['fx-lottery'])
    assert.deepEqual(coins.traps, ["Largest coin first isn't optimal for arbitrary coin sets."])

    const layers = [...coins.layers].sort((a, b) => a.position - b.position)
    assert.deepEqual(
      layers.map((l) => [l.id, l.kind]),
      [
        ['fx-coins:subject', 'subject'],
        ['fx-coins:technique', 'technique'],
        ['fx-coins:dp-state', 'dp-state'],
        ['fx-coins:dp-transition', 'dp-transition'],
      ]
    )
    const [subject, technique, state] = layers
    assert.isNull(subject.options)
    assert.deepEqual(subject.accepted, ['dp'])
    assert.isNull(subject.explanationMd)
    assert.deepEqual(technique.accepted, ['dp.coin-change', 'dp.linear'])
    assert.equal(technique.explanationMd, coins.explanationMd)
    assert.deepEqual(state.accepted, ['a'])
    assert.deepEqual(state.options?.[1], {
      id: 'b',
      text: 'dp[i] = fewest coins using the first i coin types',
      why: 'Loses the sum.',
    })
  })

  test('stores every answer with its role', async ({ assert }) => {
    await sync()

    const answers = await db
      .from('problem_answers')
      .where('problem_id', 'fx-longest-path')
      .orderBy(['kind', 'answer_id'])
      .select('kind', 'answer_id', 'role')

    assert.deepEqual(answers, [
      { kind: 'subject', answer_id: 'dp', role: 'intended' },
      { kind: 'subject', answer_id: 'graphs', role: 'accepted' },
      { kind: 'subject', answer_id: 'number-theory', role: 'accepted' },
      { kind: 'technique', answer_id: 'dp.dag', role: 'intended' },
      { kind: 'technique', answer_id: 'graphs.toposort', role: 'accepted' },
    ])
  })

  test('puts problems in sessions: intended, accepted with a technique, appearsIn', async ({
    assert,
  }) => {
    await sync()

    const rows = await db
      .from('problem_subjects')
      .whereIn('problem_id', ['fx-longest-path', 'fx-lottery'])
      .orderBy(['problem_id', 'subject_id'])
      .select('problem_id', 'subject_id', 'role', 'via')

    // number-theory is an accepted subject of fx-longest-path but lists no
    // technique of its own, so it doesn't pull the problem into NT sessions.
    assert.deepEqual(rows, [
      { problem_id: 'fx-longest-path', subject_id: 'dp', role: 'intended', via: 'answer' },
      { problem_id: 'fx-longest-path', subject_id: 'graphs', role: 'accepted', via: 'answer' },
      { problem_id: 'fx-lottery', subject_id: 'dp', role: null, via: 'appearsIn' },
      { problem_id: 'fx-lottery', subject_id: 'other', role: 'intended', via: 'answer' },
    ])
  })

  test('is idempotent', async ({ assert }) => {
    const tables = [
      'subjects',
      'techniques',
      'problems',
      'problem_subjects',
      'problem_answers',
      'layers',
    ]
    const countRows = () =>
      Promise.all(
        tables.map(async (table) => {
          const [row] = await db.from(table).count('* as total')
          return row.total
        })
      )
    await sync()
    const before = await countRows()

    const report = await sync()

    assert.deepEqual(await countRows(), before)
    assert.deepInclude(report.problems, { added: 0, changed: 0, unchanged: 4, missing: 0 })
    assert.deepEqual(report.layers, { active: 11, deprecated: 0 })
  })

  test('counts changed files', async ({ assert }) => {
    await sync()
    await fixture.editJson(BFS, (p) => (p.title = 'Renamed'))

    const report = await sync()

    assert.deepInclude(report.problems, { added: 0, changed: 1, unchanged: 3 })
    const bfs = await Problem.findOrFail('fx-bfs')
    assert.equal(bfs.title, 'Renamed')
  })

  test('marks problems and layers that left the repo as deprecated', async ({ assert }) => {
    await sync()
    await fixture.remove(BFS)
    await fixture.editJson(COINS, (p) => p.extraLayers.pop())

    const report = await sync()

    assert.equal(report.problems.missing, 1)
    // fx-bfs:subject, fx-bfs:technique, fx-coins:dp-transition
    assert.equal(report.layers.deprecated, 3)
    assert.isTrue(await isDeprecated(Problem, 'fx-bfs'))
    assert.isTrue(await isDeprecated(Layer, 'fx-bfs:technique'))
    assert.isTrue(await isDeprecated(Layer, 'fx-coins:dp-transition'))
    assert.isFalse(await isDeprecated(Layer, 'fx-coins:dp-state'))
  })

  test('brings back a problem whose file returns', async ({ assert }) => {
    await sync()
    const bfs = await fixture.read(BFS)
    await fixture.remove(BFS)
    await sync()
    await fixture.write(BFS, bfs)

    const report = await sync()

    assert.deepInclude(report.problems, { added: 0, changed: 0, unchanged: 4 })
    assert.isFalse(await isDeprecated(Problem, 'fx-bfs'))
    assert.isFalse(await isDeprecated(Layer, 'fx-bfs:subject'))
  })

  test('keeps problems retired in their file', async ({ assert }) => {
    await fixture.editJson(BFS, (p) => (p.deprecated = true))

    const report = await sync()

    assert.equal(report.problems.retired, 1)
    assert.isTrue(await isDeprecated(Problem, 'fx-bfs'))
  })

  test('leaves the database untouched when any file is invalid', async ({ assert }) => {
    await sync()
    await fixture.editJson(COINS, (p) => (p.title = 'Should not be saved'))
    await fixture.write(BFS, '{ broken')

    const result = await trySync()

    assert.isFalse(result.ok)
    const coins = await Problem.findOrFail('fx-coins')
    assert.equal(coins.title, 'Fixture Coins')
    assert.isFalse(await isDeprecated(Problem, 'fx-bfs'))
  })
})
