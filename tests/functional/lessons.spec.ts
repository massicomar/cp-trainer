import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import Attempt from '#models/attempt'
import Lesson from '#models/lesson'
import Player from '#models/player'
import Problem from '#models/problem'
import LessonFlow from '#services/lesson_flow'
import { syncFixtureContent } from '#tests/helpers/content_fixture'

const ALL_TIERS = ['easy', 'medium', 'hard']

/**
 * The setup form's field names, as a browser sends them.
 */
function setupForm(subjects: string[], tiers: string[]) {
  return { 'subjects[]': subjects, 'tiers[]': tiers }
}

/**
 * POSTs the setup form and returns the new player's cookie and lesson.
 */
async function startLesson(client: ApiClient, subjects: string[], tiers = ALL_TIERS) {
  const response = await client
    .post('/lessons')
    .form(setupForm(subjects, tiers))
    .withCsrfToken()
    .redirects(0)
  response.assertStatus(302)
  const pid = response.cookie('pid')?.value
  const lessonId = Number(response.header('location')?.match(/^\/lessons\/(\d+)$/)?.[1])
  return { pid: pid as string, lesson: await Lesson.findOrFail(lessonId) }
}

async function currentQuestion(lesson: Lesson) {
  const flow = await app.container.make(LessonFlow)
  const state = await flow.state(lesson)
  return state!.question
}

test.group('Session setup', (group) => {
  group.each.setup(async () => {
    const truncate = await testUtils.db().truncate()
    await syncFixtureContent()
    return truncate
  })

  test('offers the visible subjects and counts matching problems', async ({ client }) => {
    const response = await client.get('/')

    response.assertStatus(200)
    response.assertTextIncludes('Dynamic Programming')
    response.assertTextIncludes('Number Theory')
    response.assertTextIncludes('3 problems match')
  })

  test('refreshes the count for a selection', async ({ client }) => {
    const response = await client
      .get('/selection/count')
      .qs({ subjects: ['graphs'], tiers: ['hard'] })

    response.assertStatus(200)
    response.assertTextIncludes('1 problem matches')
  })

  test('disables Start when nothing matches', async ({ client }) => {
    const response = await client
      .get('/selection/count')
      .qs({ subjects: ['number-theory'], tiers: ALL_TIERS })

    response.assertTextIncludes('No problems match this selection yet.')
    response.assertTextIncludes('disabled')
  })

  test('creates a player and a lesson, and remembers the selection', async ({ client, assert }) => {
    const { pid, lesson } = await startLesson(client, ['graphs'], ['hard'])

    assert.isString(pid)
    assert.deepEqual(lesson.problemIds, ['fx-bfs'])
    const player = await Player.findOrFail(pid)
    assert.deepEqual(player.preferences, { subjects: ['graphs'], tiers: ['hard'] })

    const setup = await client.get('/').withCookie('pid', pid)
    assert.match(setup.text(), /value="graphs"\s+checked/)
    assert.notMatch(setup.text(), /value="dp"\s+checked/)
  })

  test('rejects an empty selection', async ({ client, assert }) => {
    const response = await client
      .post('/lessons')
      .form(setupForm([], ALL_TIERS))
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.lengthOf(await Lesson.all(), 0)
  })

  test('sends the player back when nothing matches', async ({ client, assert }) => {
    const response = await client
      .post('/lessons')
      .form(setupForm(['number-theory'], ALL_TIERS))
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader(
      'location',
      '/?subjects%5B%5D=number-theory&tiers%5B%5D=easy&tiers%5B%5D=medium&tiers%5B%5D=hard'
    )
    assert.lengthOf(await Lesson.all(), 0)
  })
})

test.group('Playing a lesson', (group) => {
  group.each.setup(async () => {
    const truncate = await testUtils.db().truncate()
    await syncFixtureContent()
    return truncate
  })

  function htmx(client: ApiClient, pid: string, lesson: Lesson, action: string, form = {}) {
    return client
      .post(`/lessons/${lesson.id}/${action}`)
      .form(form)
      .header('HX-Request', 'true')
      .withCookie('pid', pid)
      .withCsrfToken()
  }

  test('plays a whole lesson, answering everything right', async ({ client, assert }) => {
    const { pid, lesson } = await startLesson(client, ['dp', 'graphs'])
    assert.lengthOf(lesson.problemIds, 3) // fx-coins, fx-bfs, and the distractor fx-lottery

    for (let guard = 0; lesson.status !== 'done' && guard < 30; guard++) {
      const question = await currentQuestion(lesson)
      const right = question.options.find((o) => o.role === 'correct')!

      const answered = await htmx(client, pid, lesson, 'answer', {
        layerId: question.layer.id,
        option: right.id,
      })
      answered.assertStatus(200)
      answered.assertTextIncludes('Correct.')

      const next = await htmx(client, pid, lesson, 'continue')
      await lesson.refresh()
      if (lesson.isDone) {
        next.assertHeader('hx-redirect', `/lessons/${lesson.id}/summary`)
      }
    }
    assert.equal(lesson.status, 'done')

    const attempts = await Attempt.query().where('lesson_id', lesson.id)
    assert.isTrue(attempts.every((a) => a.outcome === 'correct'))
    // Subject layer asked for every problem in a two-subject session.
    assert.lengthOf(
      attempts.filter((a) => a.layerId.endsWith(':subject')),
      3
    )

    const summary = await client.get(`/lessons/${lesson.id}/summary`).withCookie('pid', pid)
    summary.assertStatus(200)
    summary.assertTextIncludes('Lesson results')
    for (const id of lesson.problemIds) {
      const problem = await Problem.findOrFail(id)
      summary.assertTextIncludes(problem.title)
    }
  })

  test('keeps the title hidden until the problem is finished', async ({ client, assert }) => {
    const { pid, lesson } = await startLesson(client, ['graphs'], ['hard'])
    const page = await client.get(`/lessons/${lesson.id}`).withCookie('pid', pid)

    page.assertStatus(200)
    page.assertTextIncludes('Find a route between two computers')
    assert.notInclude(page.text(), 'Fixture Message Route')
    assert.notInclude(page.text(), 'cses.fi')

    const question = await currentQuestion(lesson)
    const answered = await htmx(client, pid, lesson, 'answer', {
      layerId: question.layer.id,
      option: question.options.find((o) => o.role === 'wrong')!.id,
    })
    // Last (only) layer: the feedback reveals the problem.
    answered.assertTextIncludes('Not quite.')
    answered.assertTextIncludes('Fixture Message Route')
  })

  test('give up reveals the answer and records it', async ({ client, assert }) => {
    const { pid, lesson } = await startLesson(client, ['dp', 'graphs'])
    const question = await currentQuestion(lesson)

    const response = await htmx(client, pid, lesson, 'give-up', { layerId: question.layer.id })

    response.assertTextIncludes("Here's the answer:")
    const attempt = await Attempt.findByOrFail('layer_id', question.layer.id)
    assert.equal(attempt.outcome, 'gave_up')
    assert.isNull(attempt.chosen)
  })

  test('skip records the rest of the problem as skipped and moves on', async ({
    client,
    assert,
  }) => {
    const { pid, lesson } = await startLesson(client, ['dp', 'graphs'])
    const first = lesson.problemIds[0]

    const response = await htmx(client, pid, lesson, 'skip')

    response.assertTextIncludes('Problem 2 of 3')
    const attempts = await Attempt.query().where('lesson_id', lesson.id)
    assert.isAbove(attempts.length, 0)
    assert.isTrue(attempts.every((a) => a.problemId === first && a.outcome === 'skipped'))
  })

  test('a refresh resumes at the same layer with the same options', async ({ client, assert }) => {
    const { pid, lesson } = await startLesson(client, ['dp', 'graphs'])
    const question = await currentQuestion(lesson)
    await htmx(client, pid, lesson, 'answer', {
      layerId: question.layer.id,
      option: question.options[0].id,
    })
    await htmx(client, pid, lesson, 'continue')

    const first = await client.get(`/lessons/${lesson.id}`).withCookie('pid', pid)
    const second = await client.get(`/lessons/${lesson.id}`).withCookie('pid', pid)

    first.assertStatus(200)
    first.assertTextIncludes('Question 2 of')
    const options = (html: string) =>
      [...html.matchAll(/name="option" value="([^"]+)"/g)].map((m) => m[1])
    assert.isAbove(options(first.text()).length, 1)
    assert.deepEqual(options(first.text()), options(second.text()))
  })

  test('ignores answers for a layer that is not the current one', async ({ client, assert }) => {
    const { pid, lesson } = await startLesson(client, ['dp', 'graphs'])

    const response = await htmx(client, pid, lesson, 'answer', {
      layerId: 'fx-coins:dp-transition',
      option: 'a',
    })

    response.assertStatus(200)
    assert.lengthOf(await Attempt.query().where('lesson_id', lesson.id), 0)
  })

  test('answering twice keeps the first answer', async ({ client, assert }) => {
    const { pid, lesson } = await startLesson(client, ['dp', 'graphs'])
    const question = await currentQuestion(lesson)
    const [a, b] = question.options

    await htmx(client, pid, lesson, 'answer', { layerId: question.layer.id, option: a.id })
    await htmx(client, pid, lesson, 'answer', { layerId: question.layer.id, option: b.id })

    const attempts = await Attempt.query().where('lesson_id', lesson.id)
    assert.lengthOf(attempts, 1)
    assert.equal(attempts[0].chosen, a.id)
  })

  test('without HTMX, every action redirects back to the lesson page', async ({ client }) => {
    const { pid, lesson } = await startLesson(client, ['dp', 'graphs'])

    const response = await client
      .post(`/lessons/${lesson.id}/skip`)
      .withCookie('pid', pid)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', `/lessons/${lesson.id}`)
  })

  test("other browsers can't open a player's lesson", async ({ client }) => {
    const { lesson } = await startLesson(client, ['graphs'], ['hard'])

    const response = await client.get(`/lessons/${lesson.id}`)

    response.assertStatus(404)
  })

  test('next lesson reuses the selection', async ({ client, assert }) => {
    const { pid, lesson } = await startLesson(client, ['graphs'], ['hard'])
    await htmx(client, pid, lesson, 'skip')

    const response = await client
      .post(`/lessons/${lesson.id}/next`)
      .withCookie('pid', pid)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    const next = await Lesson.query().where('player_id', pid).orderBy('id', 'desc').firstOrFail()
    assert.notEqual(next.id, lesson.id)
    assert.deepEqual(next.selection, { subjects: ['graphs'], tiers: ['hard'] })
    response.assertHeader('location', `/lessons/${next.id}`)
  })

  test('the summary scores layers and leaves skipped ones out', async ({ client, assert }) => {
    const { pid, lesson } = await startLesson(client, ['graphs'], ['hard'])
    await htmx(client, pid, lesson, 'skip')
    await lesson.refresh()
    assert.equal(lesson.status, 'done')

    const flow = await app.container.make(LessonFlow)
    const summary = await flow.summary(lesson)

    assert.deepEqual(
      summary.scores.map((s) => [s.label, s.right, s.total]),
      [['Technique', 0, 0]]
    )
    assert.deepEqual(summary.problems[0].results, [{ label: 'Technique', outcome: 'skipped' }])
  })
})
