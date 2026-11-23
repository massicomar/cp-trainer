import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import Attempt from '#models/attempt'
import DrillAttempt from '#models/drill_attempt'
import Lesson from '#models/lesson'
import Player from '#models/player'
import User from '#models/user'
import Accounts, { type Identity } from '#services/accounts'
import { assertSafeAuth } from '#start/env'
import { syncFixtureContent } from '#tests/helpers/content_fixture'

const ALL_TIERS = ['easy', 'medium', 'hard']

function identity(name: string): Identity {
  return {
    provider: 'github',
    providerId: `gh-${name}`,
    username: name,
    displayName: name.toUpperCase(),
    avatarUrl: `https://avatars.example/${name}`,
  }
}

/**
 * An anonymous browser that played one round: its cookie value and lesson.
 */
async function anonymousRound(client: ApiClient, subjects = ['graphs']) {
  const response = await client
    .post('/lessons')
    .form({ 'subjects[]': subjects, 'tiers[]': ALL_TIERS, 'drills': 'off' })
    .withCsrfToken()
    .redirects(0)
  response.assertStatus(302)
  const pid = response.cookie('pid')!.value as string
  const lessonId = Number(response.header('location')?.match(/\d+$/)?.[0])
  return { pid, lesson: await Lesson.findOrFail(lessonId) }
}

/** An answer row for a lesson, as if the player had answered its first layer. */
async function answerFirstLayer(lesson: Lesson) {
  return Attempt.create({
    playerId: lesson.playerId,
    lessonId: lesson.id,
    layerId: `${lesson.problemIds[0]}:subject`,
    problemId: lesson.problemIds[0],
    chosen: 'graphs',
    outcome: 'correct',
    msTaken: 1000,
  })
}

async function signIn(name: string, anonymous: Player | null = null) {
  const accounts = await app.container.make(Accounts)
  return accounts.signIn(identity(name), anonymous)
}

test.group('Accounts · sign-in, claim and merge', (group) => {
  group.each.setup(async () => {
    const truncate = await testUtils.db().truncate()
    await syncFixtureContent()
    return truncate
  })

  test('the first sign-in claims the browser’s anonymous player', async ({ client, assert }) => {
    const { pid, lesson } = await anonymousRound(client)
    const user = await signIn('ada', await Player.findOrFail(pid))

    const player = await Player.findOrFail(pid)
    assert.equal(player.userId, user.id)
    const claimed = await Lesson.findOrFail(lesson.id)
    assert.equal(claimed.playerId, pid)
    assert.lengthOf(await Player.all(), 1)
  })

  test('without anonymous history, the account gets a fresh player', async ({ assert }) => {
    const user = await signIn('ada')

    const players = await Player.query().where('user_id', user.id)
    assert.lengthOf(players, 1)
    assert.equal(user.username, 'ada')
    assert.equal(user.displayName, 'ADA')
  })

  test('signing in from another browser merges its rounds into the account', async ({
    client,
    assert,
  }) => {
    const first = await anonymousRound(client)
    const user = await signIn('ada', await Player.findOrFail(first.pid))

    const second = await anonymousRound(client, ['dp'])
    const attempt = await answerFirstLayer(second.lesson)
    await DrillAttempt.create({
      playerId: second.pid,
      lessonId: second.lesson.id,
      itemIndex: 9,
      kind: 'max-big-o',
      drillItemId: null,
      params: {},
      answer: 'n',
      chosen: 'n',
      outcome: 'correct',
      msTaken: 500,
    })
    await signIn('ada', await Player.findOrFail(second.pid))

    assert.isNull(await Player.find(second.pid))
    const [movedLesson, movedAttempt, movedDrill] = await Promise.all([
      Lesson.findOrFail(second.lesson.id),
      Attempt.findOrFail(attempt.id),
      DrillAttempt.findByOrFail('lesson_id', second.lesson.id),
    ])
    assert.equal(movedLesson.playerId, first.pid)
    assert.equal(movedAttempt.playerId, first.pid)
    assert.equal(movedDrill.playerId, first.pid)
    // The account keeps its own last selection.
    const account = await Player.findByOrFail('user_id', user.id)
    assert.deepEqual(account.preferences?.subjects, ['graphs'])
  })

  test('signing in again refreshes the profile and the last login', async ({ assert }) => {
    const before = await signIn('ada')
    await User.query().where('id', before.id).update({ last_login_at: '2020-01-01 00:00:00' })

    const after = await signIn('ada')
    await after.refresh()
    assert.equal(after.id, before.id)
    assert.isAbove(after.lastLoginAt.toMillis(), DateTime.fromISO('2021-01-01').toMillis())
    assert.lengthOf(await User.all(), 1)
  })

  test('deleting an account removes its player and every answer, nobody else’s', async ({
    client,
    assert,
  }) => {
    const mine = await anonymousRound(client)
    await answerFirstLayer(mine.lesson)
    const user = await signIn('ada', await Player.findOrFail(mine.pid))
    const theirs = await anonymousRound(client)
    await answerFirstLayer(theirs.lesson)

    const accounts = await app.container.make(Accounts)
    await accounts.deleteAccount(user)

    assert.isNull(await User.find(user.id))
    assert.isNull(await Player.find(mine.pid))
    assert.isNull(await Lesson.find(mine.lesson.id))
    assert.lengthOf(await Attempt.query().where('player_id', mine.pid), 0)
    assert.isNotNull(await Lesson.find(theirs.lesson.id))
    assert.lengthOf(await Attempt.query().where('player_id', theirs.pid), 1)
  })

  test('production refuses the dev login', ({ assert }) => {
    assert.throws(() => assertSafeAuth('production', true), /AUTH_DEV_LOGIN/)
    assert.doesNotThrow(() => assertSafeAuth('production', false))
    assert.doesNotThrow(() => assertSafeAuth('development', true))
  })
})

test.group('Accounts · pages', (group) => {
  group.each.setup(async () => {
    const truncate = await testUtils.db().truncate()
    await syncFixtureContent()
    return truncate
  })

  test('the dev login signs in, claims the browser’s rounds and drops the cookie', async ({
    client,
    assert,
  }) => {
    const { pid } = await anonymousRound(client)

    const response = await client
      .post('/auth/dev')
      .withCookie('pid', pid)
      .form({ username: 'Grace Hopper!' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/')
    const user = await User.findByOrFail('username', 'gracehopper')
    assert.equal(user.provider, 'dev')
    const player = await Player.findOrFail(pid)
    assert.equal(player.userId, user.id)
    assert.isAtMost(response.cookie('pid')?.maxAge ?? 1, 0)
  })

  test('the login page offers the dev login and says the rounds come along', async ({ client }) => {
    const { pid } = await anonymousRound(client)
    const response = await client.get('/entrar').withCookie('pid', pid)

    response.assertStatus(200)
    response.assertTextIncludes('action="/auth/dev"')
    response.assertTextIncludes('The rounds you played in this browser are added to your account.')
  })

  test('signed in, the home is the account home with Custom', async ({ client }) => {
    const user = await signIn('ada')
    const response = await client.get('/').loginAs(user)

    response.assertStatus(200)
    response.assertTextIncludes('What are we practicing today?')
    response.assertTextIncludes('Soon')
    response.assertTextIncludes('action="/custom"')
    // First time: all subjects · easy + medium · with short questions.
    response.assertTextIncludes(
      'All subjects · Easy, Medium · all subtopics · with short questions'
    )
    response.assertTextIncludes('href="/cuenta"')
  })

  test('after signing out, the old cookie no longer opens the account’s rounds', async ({
    client,
  }) => {
    const { pid, lesson } = await anonymousRound(client)
    await signIn('ada', await Player.findOrFail(pid))

    const response = await client.get(`/lessons/${lesson.id}`).withCookie('pid', pid)
    response.assertStatus(404)
  })

  test('the account’s rounds open from any browser once signed in', async ({ client }) => {
    const { pid, lesson } = await anonymousRound(client)
    const user = await signIn('ada', await Player.findOrFail(pid))

    const response = await client.get(`/lessons/${lesson.id}`).loginAs(user)
    response.assertStatus(200)
  })

  test('account pages and Custom need a sign-in', async ({ client }) => {
    for (const url of ['/cuenta']) {
      const response = await client.get(url).redirects(0)
      response.assertStatus(302)
      response.assertHeader('location', '/entrar')
    }
    const response = await client.post('/custom').withCsrfToken().redirects(0)
    response.assertStatus(302)
    response.assertHeader('location', '/entrar')
  })

  test('the account page shows who you are and how many rounds you finished', async ({
    client,
  }) => {
    const user = await signIn('ada')
    const response = await client.get('/cuenta').loginAs(user)

    response.assertStatus(200)
    response.assertTextIncludes('@ada')
    response.assertTextIncludes('0 rounds finished')
    response.assertTextIncludes('action="/cuenta/borrar"')
  })

  test('deleting needs the box ticked, then removes the account and signs out', async ({
    client,
    assert,
  }) => {
    const user = await signIn('ada')

    const unticked = await client.post('/cuenta/borrar').loginAs(user).withCsrfToken().redirects(0)
    unticked.assertHeader('location', '/cuenta')
    assert.isNotNull(await User.find(user.id))

    const ticked = await client
      .post('/cuenta/borrar')
      .loginAs(user)
      .form({ confirm: 'yes' })
      .withCsrfToken()
      .redirects(0)
    ticked.assertHeader('location', '/')
    assert.isNull(await User.find(user.id))
    assert.lengthOf(await Player.all(), 0)
  })

  test('signing out goes home and forgets the browser’s player', async ({ client }) => {
    const user = await signIn('ada')
    const response = await client.post('/logout').loginAs(user).withCsrfToken().redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/')
  })

  test('the contribute form starts with the GitHub username as author', async ({ client }) => {
    const user = await signIn('ada')
    const response = await client.get('/contribute?new=1').loginAs(user)

    response.assertTextIncludes('name="author"')
    response.assertTextIncludes('value="ada"')
  })
})
