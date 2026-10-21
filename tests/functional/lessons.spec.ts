import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import Attempt from '#models/attempt'
import DrillAttempt from '#models/drill_attempt'
import Lesson from '#models/lesson'
import Player from '#models/player'
import Problem from '#models/problem'
import LessonFlow from '#services/lesson_flow'
import { syncFixtureContent } from '#tests/helpers/content_fixture'

const ALL_TIERS = ['easy', 'medium', 'hard']

/**
 * The setup form's field names, as a browser sends them. Drills are off
 * unless a test asks for them (the box sits after a hidden "off").
 */
function setupForm(subjects: string[], tiers: string[], problems = 'all', drills = false) {
  return {
    'subjects[]': subjects,
    'tiers[]': tiers,
    problems,
    'drills': drills ? ['off', 'on'] : 'off',
  }
}

/**
 * POSTs the setup form and returns the new player's cookie and lesson.
 */
async function startLesson(
  client: ApiClient,
  subjects: string[],
  tiers = ALL_TIERS,
  problems = 'all',
  drills = false
) {
  const response = await client
    .post('/lessons')
    .form(setupForm(subjects, tiers, problems, drills))
    .withCsrfToken()
    .redirects(0)
  response.assertStatus(302)
  const pid = response.cookie('pid')?.value
  const lessonId = Number(response.header('location')?.match(/^\/lessons\/(\d+)$/)?.[1])
  return { pid: pid as string, lesson: await Lesson.findOrFail(lessonId) }
}

/**
 * The problem question on screen, plus the step token its forms carry.
 */
async function currentQuestion(lesson: Lesson) {
  const flow = await app.container.make(LessonFlow)
  const state = await flow.state(lesson)
  if (state?.type !== 'problem') throw new Error('expected a problem on screen')
  return { ...state.question, step: state.stepToken }
}

/**
 * Whatever is on screen, problem layer or drill.
 */
async function currentStep(lesson: Lesson) {
  const flow = await app.container.make(LessonFlow)
  const state = await flow.state(lesson)
  if (!state) throw new Error('the lesson is done')
  const options: { id: string; role: string }[] =
    state.type === 'problem' ? state.question.options : state.drill.options
  return { state, options, step: state.stepToken }
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

  test('offers the two modules as presets, with the subjects that exist', async ({ client }) => {
    const response = await client.get('/')

    // The fixtures have dp, graphs and number-theory.
    response.assertTextIncludes('data-preset-subjects="dp,graphs"')
    response.assertTextIncludes('Module 1')
    response.assertTextIncludes('data-preset-subjects="number-theory"')
    response.assertTextIncludes('Module 2')
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
    assert.deepEqual(player.preferences, {
      subjects: ['graphs'],
      tiers: ['hard'],
      includeCommunity: true,
      includeDrills: false,
    })

    const setup = await client.get('/').withCookie('pid', pid)
    assert.match(setup.text(), /value="graphs"\s+checked/)
    assert.notMatch(setup.text(), /value="dp"\s+checked/)
  })

  test('"Official only" leaves community problems out, and is remembered', async ({
    client,
    assert,
  }) => {
    const { pid, lesson } = await startLesson(client, ['dp', 'graphs'], ALL_TIERS, 'official')

    assert.notInclude(lesson.problemIds, 'fx-bfs')
    assert.isFalse(lesson.includeCommunity)
    const setup = await client.get('/').withCookie('pid', pid)
    assert.match(setup.text(), /value="official"\s+checked/)
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
      '/?subjects%5B%5D=number-theory&tiers%5B%5D=easy&tiers%5B%5D=medium&tiers%5B%5D=hard&drills=off'
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
        step: question.step,
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
    // Not even in hidden fields: the id is enough to look the original up.
    assert.notInclude(page.text(), 'fx-bfs')

    const question = await currentQuestion(lesson)
    const answered = await htmx(client, pid, lesson, 'answer', {
      step: question.step,
      option: question.options.find((o) => o.role === 'wrong')!.id,
    })
    // Last (only) layer: the feedback reveals the problem.
    answered.assertTextIncludes('Not quite.')
    answered.assertTextIncludes('Fixture Message Route')
    // fx-bfs was added by a classmate to the community collection.
    answered.assertTextIncludes('@classmate')
    answered.assertTextIncludes('Community')
  })

  test('give up reveals the answer and records it', async ({ client, assert }) => {
    const { pid, lesson } = await startLesson(client, ['dp', 'graphs'])
    const question = await currentQuestion(lesson)

    const response = await htmx(client, pid, lesson, 'give-up', { step: question.step })

    response.assertTextIncludes('Here’s the answer:')
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
      step: question.step,
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
      step: '0.3',
      option: 'a',
    })

    response.assertStatus(200)
    assert.lengthOf(await Attempt.query().where('lesson_id', lesson.id), 0)
  })

  test('answering twice keeps the first answer', async ({ client, assert }) => {
    const { pid, lesson } = await startLesson(client, ['dp', 'graphs'])
    const question = await currentQuestion(lesson)
    const [a, b] = question.options

    await htmx(client, pid, lesson, 'answer', { step: question.step, option: a.id })
    await htmx(client, pid, lesson, 'answer', { step: question.step, option: b.id })

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
    assert.deepEqual(next.selection, {
      subjects: ['graphs'],
      tiers: ['hard'],
      includeCommunity: true,
      includeDrills: false,
    })
    response.assertHeader('location', `/lessons/${next.id}`)
  })

  test('"Report a problem" opens a pre-filled issue for the current question', async ({
    client,
    assert,
  }) => {
    const { pid, lesson } = await startLesson(client, ['dp', 'graphs'])
    const first = lesson.problemIds[0]

    const response = await client
      .get(`/lessons/${lesson.id}/report`)
      .qs({ step: '0.0' })
      .withCookie('pid', pid)
      .redirects(0)

    response.assertStatus(302)
    const location = new URL(response.header('location')!)
    assert.equal(
      location.origin + location.pathname,
      'https://github.com/massicomar/cp-trainer-content/issues/new'
    )
    assert.equal(location.searchParams.get('template'), 'problem-report.yml')
    assert.equal(location.searchParams.get('problem'), first)
    assert.equal(location.searchParams.get('layer'), 'subject')
  })

  test("reports can't reveal problems the player hasn't reached", async ({ client }) => {
    const { pid, lesson } = await startLesson(client, ['dp', 'graphs'])

    const response = await client
      .get(`/lessons/${lesson.id}/report`)
      .qs({ problem: '2' })
      .withCookie('pid', pid)
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', `/lessons/${lesson.id}`)
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
    assert.deepEqual(summary.problems[0].results, [
      { kind: 'technique', label: 'Technique', outcome: 'skipped' },
    ])
  })

  test('with the UI in Spanish, explanations use the es block and fall back to English', async ({
    client,
    assert,
  }) => {
    const { pid, lesson } = await startLesson(client, ['dp'])
    const seen: string[] = []

    for (let guard = 0; lesson.status !== 'done' && guard < 30; guard++) {
      const question = await currentQuestion(lesson)
      // fx-coins: pick the wrong option on dp-state (it has a Spanish "why"), else answer right.
      const option =
        question.layer.id === 'fx-coins:dp-state'
          ? 'b'
          : question.options.find((o) => o.role === 'correct')!.id
      const answered = await htmx(client, pid, lesson, 'answer', {
        step: question.step,
        option,
      }).withPlainCookie('locale', 'es')
      if (question.layer.problemId === 'fx-coins') seen.push(answered.text())
      await htmx(client, pid, lesson, 'continue')
      await lesson.refresh()
    }

    const [technique, state, transition] = seen
    assert.include(technique, 'Monedas ilimitadas y un objetivo chico: dp sobre la suma.')
    assert.include(state, 'lang="es"')
    assert.include(state, 'Pierde la suma.')
    assert.include(state, 'Solo importa la suma que falta.')
    // No Spanish for the transition layer: the English explanation, marked as English.
    assert.match(transition, /lang="en">\s*The last coin is one of the n values./)
    assert.include(transition, 'Tomar primero la moneda más grande no es óptimo')

    const summary = await client
      .get(`/lessons/${lesson.id}/summary`)
      .withCookie('pid', pid)
      .withPlainCookie('locale', 'es')
    summary.assertTextIncludes('Monedas ilimitadas y un objetivo chico')
    const english = await client.get(`/lessons/${lesson.id}/summary`).withCookie('pid', pid)
    english.assertTextIncludes('Unbounded coins and a small target')
  })
})

test.group('Lessons with drills', (group) => {
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

  test('drills come after the 1st and 3rd problems and play like one-layer problems', async ({
    client,
    assert,
  }) => {
    const { pid, lesson } = await startLesson(client, ['dp', 'graphs'], ALL_TIERS, 'all', true)
    assert.isTrue(lesson.includeDrills)
    assert.deepEqual(
      lesson.items.map((i) => i.type),
      ['problem', 'drill', 'problem', 'problem', 'drill']
    )

    const page = await client.get(`/lessons/${lesson.id}`).withCookie('pid', pid)
    page.assertTextIncludes('progress__step--drill')

    const drillPages: string[] = []
    for (let guard = 0; lesson.status !== 'done' && guard < 30; guard++) {
      const { state, options, step } = await currentStep(lesson)
      const right = options.find((o) => o.role === 'correct')!
      const answered = await htmx(client, pid, lesson, 'answer', { step, option: right.id })
      answered.assertTextIncludes('Correct.')
      if (state.type === 'drill') drillPages.push(answered.text())
      await htmx(client, pid, lesson, 'continue')
      await lesson.refresh()
    }

    assert.equal(lesson.status, 'done')
    assert.lengthOf(drillPages, 2)
    for (const html of drillPages) {
      assert.include(html, 'Quick question')
      // Generated drills explain the arithmetic; algorithm drills, the authored text.
      assert.match(html, /simple operations fit in one second|Each (vertex|edge)/)
    }
    const drills = await DrillAttempt.query().where('lesson_id', lesson.id).orderBy('item_index')
    assert.deepEqual(
      drills.map((d) => [d.itemIndex, d.outcome]),
      [
        [1, 'correct'],
        [4, 'correct'],
      ]
    )
    assert.equal(drills[0].answer, drills[0].chosen)

    const summary = await client.get(`/lessons/${lesson.id}/summary`).withCookie('pid', pid)
    const labels = drills.map((d) => `messages.kinds.${d.kind}`)
    assert.lengthOf(labels, 2)
    summary.assertTextIncludes('1/1')
    assert.match(
      summary.text(),
      /Largest complexity|Complexity of an algorithm|Largest n|Fits or not/
    )
  })

  test('a drill in Spanish explains in Spanish', async ({ client, assert }) => {
    const { pid, lesson } = await startLesson(client, ['dp'], ALL_TIERS, 'all', true)
    await htmx(client, pid, lesson, 'skip')
    await lesson.refresh()
    const { state, step } = await currentStep(lesson)
    assert.equal(state.type, 'drill')

    const response = await htmx(client, pid, lesson, 'give-up', { step }).withPlainCookie(
      'locale',
      'es'
    )

    response.assertTextIncludes('Pregunta rápida')
    response.assertTextIncludes('Esta es la respuesta:')
    // dp has no algorithm drills in the fixtures, so this one is generated.
    response.assertTextIncludes('En un segundo entran unas')
    const attempt = await DrillAttempt.findByOrFail('lesson_id', lesson.id)
    assert.equal(attempt.outcome, 'gave_up')
  })

  test('skip on a drill records it as skipped and moves on', async ({ client, assert }) => {
    const { pid, lesson } = await startLesson(client, ['dp'], ALL_TIERS, 'all', true)
    await htmx(client, pid, lesson, 'skip') // the first problem
    const response = await htmx(client, pid, lesson, 'skip') // the drill

    response.assertTextIncludes('Problem 2 of')
    const attempt = await DrillAttempt.findByOrFail('lesson_id', lesson.id)
    assert.deepInclude(attempt.$attributes, { itemIndex: 1, outcome: 'skipped', chosen: null })
  })

  test('"Report a problem" on a drill names its file and what was asked', async ({
    client,
    assert,
  }) => {
    const { pid, lesson } = await startLesson(client, ['dp'], ALL_TIERS, 'all', true)
    await htmx(client, pid, lesson, 'skip')

    const response = await client
      .get(`/lessons/${lesson.id}/report`)
      .qs({ step: '1.0' })
      .withCookie('pid', pid)
      .redirects(0)

    response.assertStatus(302)
    const location = new URL(response.header('location')!)
    assert.equal(location.searchParams.get('problem'), 'drills/big-o.json')
    assert.match(location.searchParams.get('title')!, /^Report: drill (max-big-o|max-n|fits) \(/)
    // Not reached yet: the drill after the 3rd problem.
    const ahead = await client
      .get(`/lessons/${lesson.id}/report`)
      .qs({ step: '4.0' })
      .withCookie('pid', pid)
      .redirects(0)
    ahead.assertHeader('location', `/lessons/${lesson.id}`)
  })

  test('the setup page has the quick questions box, remembered per player', async ({
    client,
    assert,
  }) => {
    const fresh = await client.get('/')
    assert.match(fresh.text(), /name="drills" value="on"\s+checked/)

    const { pid } = await startLesson(client, ['dp'], ALL_TIERS, 'all', false)
    const setup = await client.get('/').withCookie('pid', pid)
    assert.notMatch(setup.text(), /name="drills" value="on"\s+checked/)
  })
})
