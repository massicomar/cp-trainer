import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import contentConfig from '#config/content'
import Problem from '#models/problem'
import SessionSelection from '#services/session_selection'
import type { Tier } from '#types/content'
import { syncFixtureContent } from '#tests/helpers/content_fixture'

const VISIBLE = ['dp', 'graphs', 'number-theory']
const ALL_TIERS: Tier[] = ['easy', 'medium', 'hard']

const pick = (subjects: string[], tiers: Tier[] = ALL_TIERS, includeCommunity = true) => ({
  subjects,
  tiers,
  includeCommunity,
})

test.group('SessionSelection', (group) => {
  const selection = new SessionSelection()

  group.each.setup(async () => {
    const truncate = await testUtils.db().truncate()
    await syncFixtureContent()
    return async () => {
      contentConfig.includeDrafts = false
      await truncate()
    }
  })

  test('offers only visible subjects, in taxonomy order', async ({ assert }) => {
    const subjects = await selection.visibleSubjects()

    assert.deepEqual(
      subjects.map((s) => s.id),
      VISIBLE
    )
  })

  test('normalizes input: drops unknown or hidden subjects and bad tiers', ({ assert }) => {
    const result = selection.normalize(
      { subjects: ['graphs', 'other', 'nope', 'dp'], tiers: ['hard', 'extreme', 'easy'] },
      VISIBLE
    )

    assert.deepEqual(result, pick(['dp', 'graphs'], ['easy', 'hard']))
    assert.deepEqual(
      selection.normalize({ subjects: 'dp', tiers: 'easy' }, VISIBLE),
      pick(['dp'], ['easy'])
    )
    assert.isFalse(selection.isComplete(selection.normalize({ subjects: ['dp'] }, VISIBLE)))
  })

  test('includes community problems unless asked not to', ({ assert }) => {
    const base = { subjects: ['dp'], tiers: ['easy'] }

    assert.isTrue(selection.normalize(base, VISIBLE).includeCommunity)
    assert.isTrue(selection.normalize({ ...base, problems: 'all' }, VISIBLE).includeCommunity)
    assert.isFalse(selection.normalize({ ...base, problems: 'official' }, VISIBLE).includeCommunity)
    // Stored preferences use the boolean.
    assert.isFalse(
      selection.normalize({ ...base, includeCommunity: false }, VISIBLE).includeCommunity
    )
  })

  test('counts ready problems, including distractors that appear in the subject', async ({
    assert,
  }) => {
    // dp: fx-coins (ready) + fx-lottery (appearsIn: dp). fx-longest-path is a draft.
    assert.equal(await selection.count(pick(['dp'])), 2)
    assert.equal(await selection.count(pick(['graphs'])), 1)
    assert.equal(await selection.count(pick(['dp', 'graphs'])), 3)
    assert.equal(await selection.count(pick(['number-theory'])), 0)
  })

  test('respects tiers', async ({ assert }) => {
    assert.equal(await selection.count(pick(['dp', 'graphs'], ['hard'])), 1)
    assert.equal(await selection.count(pick(['dp'], ['medium'])), 0)
    assert.equal(await selection.count(pick(['dp'], [])), 0)
  })

  test('can leave out community problems', async ({ assert }) => {
    // fx-bfs is the only community problem.
    assert.equal(await selection.count(pick(['graphs'], ALL_TIERS, false)), 0)
    assert.equal(await selection.count(pick(['dp', 'graphs'], ALL_TIERS, false)), 2)
  })

  test('leaves out deprecated problems', async ({ assert }) => {
    await Problem.query().where('id', 'fx-coins').update({ deprecated: true })

    assert.equal(await selection.count(pick(['dp'])), 1)
  })

  test('includes drafts in preview mode', async ({ assert }) => {
    contentConfig.includeDrafts = true

    // fx-longest-path is dp (intended) and graphs (accepted, with its own technique),
    // but not number-theory (accepted without a technique).
    assert.equal(await selection.count(pick(['dp'])), 3)
    assert.equal(await selection.count(pick(['graphs'])), 2)
    assert.equal(await selection.count(pick(['number-theory'])), 0)
  })

  test('counts per subject for the setup chips', async ({ assert }) => {
    assert.deepEqual(await selection.countBySubject(ALL_TIERS), { dp: 2, graphs: 1, other: 1 })
  })
})
