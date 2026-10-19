import { test } from '@japa/runner'
import ContentLoader, { type LoadResult } from '#services/content_loader'
import { ContentFixture } from '#tests/helpers/content_fixture'

const BFS = 'problems/graphs/fx-bfs.json'
const COINS = 'problems/dp/fx-coins.json'

function errorsOf(result: LoadResult) {
  return result.ok ? [] : result.errors.map((e) => `${e.file}: ${e.message}`)
}

test.group('ContentLoader', (group) => {
  let fixture: ContentFixture
  const load = () => new ContentLoader().load(fixture.dir)

  group.each.setup(async () => {
    fixture = await ContentFixture.create()
    return () => fixture.cleanup()
  })

  test('loads valid content with relative paths and file hashes', async ({ assert }) => {
    const result = await load()

    assert.deepEqual(errorsOf(result), [])
    assert.isTrue(result.ok)
    if (!result.ok) return

    assert.lengthOf(result.content.taxonomy.subjects, 4)
    assert.sameMembers(
      result.content.problems.map(({ problem }) => problem.id),
      ['fx-coins', 'fx-longest-path', 'fx-bfs', 'fx-lottery']
    )
    const coins = result.content.problems.find(({ problem }) => problem.id === 'fx-coins')!
    assert.equal(coins.file, COINS)
    assert.match(coins.hash, /^[0-9a-f]{64}$/)
  })

  test('reports schema errors with the file they come from', async ({ assert }) => {
    await fixture.editJson(BFS, (p) => {
      delete p.explanation
      p.colour = 'blue'
    })

    const errors = errorsOf(await load())

    assert.isTrue(errors.some((e) => e.startsWith(BFS) && e.includes("'explanation'")))
    assert.isTrue(errors.some((e) => e.startsWith(BFS) && e.includes('"colour"')))
  })

  test('requires a real summary once a problem is ready', async ({ assert }) => {
    await fixture.editJson(BFS, (p) => (p.summary = ''))

    const errors = errorsOf(await load())

    assert.isTrue(errors.some((e) => e.startsWith(`${BFS}: schema /summary`)))
  })

  test('reports invalid JSON', async ({ assert }) => {
    await fixture.write(BFS, '{ "id": ')

    const errors = errorsOf(await load())

    assert.isTrue(errors.some((e) => e.startsWith(`${BFS}: invalid JSON`)))
  })

  test('reports references to things that do not exist', async ({ assert }) => {
    await fixture.editJson(COINS, (p) => {
      p.distractors.push('dp.nope')
      p.pairWith = ['fx-missing']
      p.appearsIn = ['nope']
    })

    const errors = errorsOf(await load())

    assert.includeMembers(errors, [
      `${COINS}: distractors: unknown technique dp.nope`,
      `${COINS}: pairWith: unknown problem fx-missing`,
      `${COINS}: appearsIn: unknown subject nope`,
    ])
  })

  test('checks answer roles', async ({ assert }) => {
    await fixture.editJson(BFS, (p) => {
      p.answers.techniques = [
        { id: 'dp.linear', role: 'intended' },
        { id: 'graphs.bfs', role: 'intended' },
      ]
    })
    await fixture.editJson(COINS, (p) => p.distractors.push('dp.linear'))

    const errors = errorsOf(await load())

    assert.includeMembers(errors, [
      `${BFS}: answers.techniques needs exactly one "intended"`,
      `${BFS}: technique dp.linear belongs to dp, which isn't in answers.subjects`,
      `${COINS}: distractor dp.linear is also a correct answer`,
    ])
  })

  test('checks extra layers', async ({ assert }) => {
    await fixture.editJson(COINS, (p) => {
      p.extraLayers[0].key = 'technique'
      p.extraLayers[1].accepted = ['a', 'b']
      p.extraLayers.push({ ...p.extraLayers[1], key: 'extra', accepted: ['z'] })
    })

    const errors = errorsOf(await load())

    assert.includeMembers(errors, [
      `${COINS}: layer key "technique" is reserved for the generated layer`,
      `${COINS}: layer dp-transition: every option is accepted`,
      `${COINS}: layer extra: accepted "z" is not an option`,
    ])
  })

  test('rejects duplicate problem ids', async ({ assert }) => {
    await fixture.writeJson('problems/graphs/fx-bfs-copy.json', await fixture.readJson(BFS))

    const errors = errorsOf(await load())

    assert.isTrue(errors.some((e) => e.includes('duplicate id fx-bfs')))
  })

  test('stops at a broken taxonomy', async ({ assert }) => {
    await fixture.editJson('taxonomy.json', (t) => delete t.subjects[0].name)

    const result = await load()

    assert.isFalse(result.ok)
    assert.isTrue(errorsOf(result).every((e) => e.startsWith('taxonomy.json')))
  })
})
