import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import i18nManager from '@adonisjs/i18n/services/main'
import Lesson from '#models/lesson'
import Player from '#models/player'
import Subject from '#models/subject'
import type User from '#models/user'
import { describe } from '#controllers/home_controller'
import Accounts from '#services/accounts'
import { DRILLS_ONLY_SIZE, pickDrills, planDrillsOnly } from '#services/drill_planner'
import { seededRandom } from '#services/random'
import SessionSelection, { selectionQuery } from '#services/session_selection'
import { syncFixtureContent } from '#tests/helpers/content_fixture'

const ALL_TIERS = ['easy', 'medium', 'hard']

async function signIn(name = 'ada'): Promise<User> {
  const accounts = await app.container.make(Accounts)
  return accounts.signIn(
    { provider: 'dev', providerId: name, username: name, displayName: null, avatarUrl: null },
    null
  )
}

/** POSTs the Custom panel and returns the redirect. */
async function startCustom(
  client: import('@japa/api-client').ApiClient,
  user: User,
  form: Record<string, unknown>
) {
  return client
    .post('/custom')
    .loginAs(user)
    .form({ techniqueFilter: 'on', drillKindFilter: 'on', ...form })
    .withCsrfToken()
    .redirects(0)
}

async function lessonFrom(location: string | undefined) {
  const id = Number(location?.match(/^\/lessons\/(\d+)$/)?.[1])
  return Lesson.findOrFail(id)
}

test.group('Custom · selection', (group) => {
  group.each.setup(async () => {
    const truncate = await testUtils.db().truncate()
    await syncFixtureContent()
    return truncate
  })

  test('offers the techniques that have playable problems, with counts', async ({ assert }) => {
    const selection = await app.container.make(SessionSelection)
    const choices = await selection.techniqueChoices()

    assert.deepEqual(
      choices.map((c) => [c.id, c.count]),
      [
        ['dp.linear', 1],
        ['dp.coin-change', 1],
        ['graphs.bfs', 1],
        ['other.greedy', 1],
      ].sort(
        (a, b) => choices.findIndex((c) => c.id === a[0]) - choices.findIndex((c) => c.id === b[0])
      )
    )
    // Drafts (fx-longest-path) and overkill answers (graphs.dijkstra) don't count.
    assert.notInclude(
      choices.map((c) => c.id),
      'graphs.dijkstra'
    )
    assert.notInclude(
      choices.map((c) => c.id),
      'dp.dag'
    )
  })

  test('a technique filter keeps the selected subjects’ ticked techniques; all ticked is none', async ({
    assert,
  }) => {
    const selection = await app.container.make(SessionSelection)
    const choices = await selection.techniqueChoices()
    const ids = ['dp', 'graphs']

    const narrowed = selection.normalize(
      {
        subjects: ['dp'],
        tiers: ALL_TIERS,
        techniqueFilter: 'on',
        techniques: ['dp.coin-change', 'graphs.bfs'],
      },
      ids,
      choices
    )
    assert.deepEqual(narrowed.techniques, ['dp.coin-change'])

    const all = selection.normalize(
      {
        subjects: ['dp'],
        tiers: ALL_TIERS,
        techniqueFilter: 'on',
        techniques: ['dp.linear', 'dp.coin-change'],
      },
      ids,
      choices
    )
    assert.isNull(all.techniques)

    const none = selection.normalize(
      { subjects: ['dp'], tiers: ALL_TIERS, techniqueFilter: 'on' },
      ids,
      choices
    )
    assert.deepEqual(none.techniques, [])
    assert.equal(selection.missing(none), 'techniques')

    // The anonymous form has no marker: no filter at all.
    const anonymous = selection.normalize({ subjects: ['dp'], tiers: ALL_TIERS }, ids, choices)
    assert.notProperty(anonymous, 'techniques')
  })

  test('short questions: only, and the kinds (all four is no filter)', async ({ assert }) => {
    const selection = await app.container.make(SessionSelection)
    const ids = ['dp', 'graphs']

    const only = selection.normalize(
      {
        subjects: ['graphs'],
        drills: 'only',
        drillKindFilter: 'on',
        drillKinds: ['max-n', 'fits'],
      },
      ids
    )
    assert.isTrue(only.drillsOnly)
    assert.deepEqual(only.drillKinds, ['max-n', 'fits'])
    // No tiers needed for short questions only.
    assert.isTrue(selection.isComplete(only))

    const all = selection.normalize(
      {
        subjects: ['graphs'],
        tiers: ALL_TIERS,
        drills: 'mixed',
        drillKindFilter: 'on',
        drillKinds: ['max-big-o', 'algorithm-big-o', 'max-n', 'fits'],
      },
      ids
    )
    assert.isTrue(all.includeDrills)
    assert.isUndefined(all.drillsOnly)
    assert.isNull(all.drillKinds)

    const noKind = selection.normalize(
      { subjects: ['graphs'], tiers: ALL_TIERS, drills: 'mixed', drillKindFilter: 'on' },
      ids
    )
    assert.equal(selection.missing(noKind), 'drillKinds')

    const off = selection.normalize({ subjects: ['graphs'], tiers: ALL_TIERS, drills: 'off' }, ids)
    assert.isFalse(off.includeDrills)
  })

  test('the query string round-trips a Custom selection', async ({ assert }) => {
    const selection = await app.container.make(SessionSelection)
    const choices = await selection.techniqueChoices()
    const original = {
      subjects: ['dp'],
      tiers: ['easy' as const],
      includeCommunity: false,
      includeDrills: true,
      drillsOnly: true,
      techniques: ['dp.linear'],
      drillKinds: ['fits' as const],
    }
    const query = Object.fromEntries(
      [...new URLSearchParams(selectionQuery(original)).keys()].map((key) => [
        key.replace('[]', ''),
        new URLSearchParams(selectionQuery(original)).getAll(key),
      ])
    )
    const back = selection.normalize(
      {
        ...query,
        problems: query.problems?.[0],
        drills: query.drills,
        techniqueFilter: query.techniqueFilter?.[0],
        drillKindFilter: query.drillKindFilter?.[0],
      },
      ['dp', 'graphs'],
      choices
    )
    assert.deepEqual(back, original)
  })

  test('the closed card describes the selection in one line', async ({ assert }) => {
    const subjects = await Subject.query().where('hidden', false).orderBy('position')
    const i18n = i18nManager.locale('en')
    const t = (key: string, data?: Record<string, unknown>) => i18n.t(key, data)
    const all = subjects.map((s) => s.id)

    assert.equal(
      describe(
        { subjects: all, tiers: ['easy', 'medium'], includeCommunity: true, includeDrills: true },
        subjects,
        t
      ),
      'All subjects · Easy, Medium · all subtopics · with short questions'
    )
    assert.equal(
      describe(
        {
          subjects: ['dp'],
          tiers: ['hard'],
          includeCommunity: false,
          includeDrills: false,
          techniques: ['dp.linear'],
        },
        subjects,
        t
      ),
      `${subjects.find((s) => s.id === 'dp')!.name} · Hard · 1 subtopic · Official only · no short questions`
    )
    assert.equal(
      describe(
        {
          subjects: all,
          tiers: [],
          includeCommunity: true,
          includeDrills: true,
          drillsOnly: true,
        },
        subjects,
        t
      ),
      'All subjects · short questions only'
    )
  })
})

test.group('Custom · drill planning', () => {
  test('a kinds filter only asks those kinds', ({ assert }) => {
    for (const seed of ['a', 'b', 'c']) {
      const drills = pickDrills(
        6,
        { generated: true, algorithms: ['graphs:bfs'] },
        ['max-n', 'fits'],
        seededRandom(seed)
      )
      assert.lengthOf(drills, 6)
      for (const drill of drills) {
        assert.include(['max-n', 'fits'], drill.type === 'drill' && drill.kind)
      }
    }
  })

  test('algorithms are asked once each; when they run out, a generated kind fills in', ({
    assert,
  }) => {
    const drills = pickDrills(
      8,
      { generated: true, algorithms: ['graphs:bfs', 'graphs:dijkstra-heap'] },
      ['algorithm-big-o', 'max-big-o'],
      seededRandom('d')
    )
    const algorithmIds = drills.flatMap((d) =>
      d.type === 'drill' && d.algorithmId ? [d.algorithmId] : []
    )
    assert.lengthOf(drills, 8)
    assert.sameMembers(algorithmIds, ['graphs:bfs', 'graphs:dijkstra-heap'])

    const onlyAlgorithms = pickDrills(
      8,
      { generated: true, algorithms: ['graphs:bfs'] },
      ['algorithm-big-o'],
      seededRandom('e')
    )
    assert.lengthOf(onlyAlgorithms, 1)
  })

  test('a short-questions-only round is as long as a full round', ({ assert }) => {
    const items = planDrillsOnly({ generated: true, algorithms: [] }, seededRandom('f'))
    assert.lengthOf(items, DRILLS_ONLY_SIZE)
    assert.isTrue(items.every((i) => i.type === 'drill'))
    assert.lengthOf(planDrillsOnly({ generated: false, algorithms: [] }, seededRandom('g')), 0)
  })
})

test.group('Custom · rounds', (group) => {
  group.each.setup(async () => {
    const truncate = await testUtils.db().truncate()
    await syncFixtureContent()
    return truncate
  })

  test('the one-tap Start plays the default the first time', async ({ client, assert }) => {
    const user = await signIn()
    const response = await client
      .post('/custom')
      .loginAs(user)
      .form({ saved: '1' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    const lesson = await lessonFrom(response.header('location'))
    assert.deepEqual(lesson.tiers, ['easy', 'medium'])
    assert.isTrue(lesson.includeDrills)
    assert.isFalse(lesson.drillsOnly)
    // Graphs' only problem is hard, so it isn't in.
    assert.notInclude(lesson.problemIds, 'fx-bfs')
  })

  test('a subtopic filter leaves the other problems out', async ({ client, assert }) => {
    const user = await signIn()

    const unfiltered = await startCustom(client, user, {
      'subjects[]': ['dp'],
      'tiers[]': ALL_TIERS,
      'techniques[]': ['dp.linear', 'dp.coin-change'],
      'drills': 'off',
    })
    const all = await lessonFrom(unfiltered.header('location'))
    assert.sameMembers(all.problemIds, ['fx-coins', 'fx-lottery'])

    const filtered = await startCustom(client, user, {
      'subjects[]': ['dp'],
      'tiers[]': ALL_TIERS,
      'techniques[]': ['dp.coin-change'],
      'drills': 'off',
    })
    const lesson = await lessonFrom(filtered.header('location'))
    assert.deepEqual(lesson.problemIds, ['fx-coins'])
    assert.deepEqual(lesson.techniqueIds, ['dp.coin-change'])
    // The next round keeps the filter.
    assert.deepEqual(lesson.selection.techniques, ['dp.coin-change'])
    const player = await Player.findByOrFail('user_id', user.id)
    assert.deepEqual(player.preferences?.techniques, ['dp.coin-change'])
  })

  test('no subtopic ticked sends you back with a message', async ({ client, assert }) => {
    const user = await signIn()
    const response = await startCustom(client, user, {
      'subjects[]': ['dp'],
      'tiers[]': ALL_TIERS,
      'drills': 'off',
    })

    response.assertStatus(302)
    assert.match(response.header('location') ?? '', /^\/\?/)
    response.assertFlashMessage('error', 'Tick at least one subtopic.')
  })

  test('short questions only: a round of drills of the ticked kinds', async ({
    client,
    assert,
  }) => {
    const user = await signIn()
    const response = await startCustom(client, user, {
      'subjects[]': ['graphs'],
      'drills': 'only',
      'drillKinds[]': ['max-n', 'fits'],
    })

    const lesson = await lessonFrom(response.header('location'))
    assert.isTrue(lesson.drillsOnly)
    assert.deepEqual(lesson.problemIds, [])
    assert.lengthOf(lesson.items, DRILLS_ONLY_SIZE)
    for (const item of lesson.items) {
      assert.include(['max-n', 'fits'], item.type === 'drill' && item.kind)
    }

    const page = await client.get(`/lessons/${lesson.id}`).loginAs(user)
    page.assertTextIncludes(`Quick question 1 of ${DRILLS_ONLY_SIZE}`)
  })

  test('the Custom panel counts with the subtopic filter and warns about one subtopic', async ({
    client,
  }) => {
    const user = await signIn()
    const query = new URLSearchParams()
    query.append('subjects[]', 'dp')
    for (const tier of ALL_TIERS) query.append('tiers[]', tier)
    query.append('techniqueFilter', 'on')
    query.append('techniques[]', 'dp.coin-change')

    const response = await client.get(`/selection/count?${query}`).loginAs(user)
    response.assertTextIncludes('1 problem matches')
    response.assertTextIncludes('the technique question will be obvious')
  })

  test('"Change selection" reopens the panel with the round’s options', async ({
    client,
    assert,
  }) => {
    const user = await signIn()
    const started = await startCustom(client, user, {
      'subjects[]': ['dp'],
      'tiers[]': ALL_TIERS,
      'techniques[]': ['dp.coin-change'],
      'drills': 'off',
    })
    const lesson = await lessonFrom(started.header('location'))
    await client.post(`/lessons/${lesson.id}/skip`).loginAs(user).withCsrfToken()
    await lesson.refresh()
    assert.isTrue(lesson.isDone)

    const summary = await client.get(`/lessons/${lesson.id}/summary`).loginAs(user)
    const change = summary
      .text()
      .match(/href="(\/\?[^"]*)"/)?.[1]
      ?.replaceAll('&amp;', '&')
    assert.include(change, 'techniqueFilter=on')

    const home = await client.get(change!).loginAs(user)
    home.assertTextIncludes('<details class="custom__panel" open')
    home.assertTextIncludes('1 subtopic')
  })
})
