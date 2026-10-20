import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import contentConfig from '#config/content'
import ProblemDraft from '#services/problem_draft'
import type { ProblemFile } from '#types/content'
import { FIXTURE_DIR, syncFixtureContent } from '#tests/helpers/content_fixture'
import { formFields } from '#tests/helpers/problem_form'

const COINS = join(FIXTURE_DIR, 'problems/dp/fx-coins.json')

async function fixture(path: string): Promise<ProblemFile> {
  return JSON.parse(await readFile(path, 'utf8'))
}

/** A valid new problem in the fixture taxonomy. */
function newProblem(overrides: Partial<ProblemFile> = {}): ProblemFile {
  return {
    schemaVersion: 1,
    id: 'fx-new',
    status: 'ready',
    author: 'classmate',
    collection: 'community',
    title: 'New Fixture',
    source: 'CSES',
    url: 'https://cses.fi/problemset/task/1',
    difficulty: { tier: 'easy', scale: 'estimate', value: 'E' },
    summary: 'Count the ways to climb a staircase taking one or two steps at a time.',
    constraints: { text: 'n ≤ 1e6', verified: true },
    answers: {
      subjects: [{ id: 'dp', role: 'intended' }],
      techniques: [{ id: 'dp.linear', role: 'intended' }],
    },
    distractors: ['other.greedy'],
    explanation: 'The last step is 1 or 2.',
    traps: [],
    pairWith: [],
    extraLayers: [],
    deprecated: false,
    ...overrides,
  }
}

test.group('ProblemDraft', (group) => {
  let drafts: ProblemDraft
  const originalDir = contentConfig.dir

  group.setup(async () => {
    const truncate = await testUtils.db().truncate()
    await syncFixtureContent()
    // Schema and files come from the fixture repo.
    contentConfig.dir = FIXTURE_DIR
    drafts = await app.container.make(ProblemDraft)
    return async () => {
      contentConfig.dir = originalDir
      await truncate()
    }
  })

  test('turns the form back into the exact file it came from', async ({ assert }) => {
    const original = await readFile(COINS, 'utf8')
    const problem = drafts.fromForm(formFields(JSON.parse(original)))

    assert.equal(drafts.toJson(problem), original)
  })

  test('names options a, b, c… in order and keeps the ticked ones', ({ assert }) => {
    const problem = drafts.fromForm({
      ...formFields(newProblem()),
      layers: [
        {
          key: 'dp-state',
          kind: 'dp-state',
          prompt: 'State?',
          explanation: 'Because.',
          options: [
            { text: 'first', why: 'nope' },
            { text: '' }, // empty rows are dropped
            { text: 'second', correct: 'on' },
          ],
        },
      ],
    })

    assert.deepEqual(problem.extraLayers, [
      {
        key: 'dp-state',
        kind: 'dp-state',
        prompt: 'State?',
        options: [
          { id: 'a', text: 'first', why: 'nope' },
          { id: 'b', text: 'second' },
        ],
        accepted: ['b'],
        explanation: 'Because.',
      },
    ])
  })

  test('drops empty rows and duplicate list entries', ({ assert }) => {
    const problem = drafts.fromForm({
      ...formFields(newProblem()),
      techniques: [
        { id: 'dp.linear', role: 'intended' },
        { id: '', role: 'accepted' },
      ],
      distractors: ['other.greedy', '', 'other.greedy'],
    })

    assert.deepEqual(problem.answers.techniques, [{ id: 'dp.linear', role: 'intended' }])
    assert.deepEqual(problem.distractors, ['other.greedy'])
  })

  test('puts the file under its intended subject', ({ assert }) => {
    assert.equal(drafts.path(newProblem()), 'problems/dp/fx-new.json')
    assert.isNull(drafts.path(newProblem({ id: '' })))
  })

  test('a valid new problem passes', async ({ assert }) => {
    assert.deepEqual(await drafts.check(newProblem(), null), { errors: [], warnings: [] })
  })

  test('runs the schema and reference checks', async ({ assert }) => {
    const { errors } = await drafts.check(
      newProblem({
        answers: {
          subjects: [{ id: 'dp', role: 'intended' }],
          techniques: [{ id: 'dp.nope', role: 'intended' }],
        },
        pairWith: ['fx-missing'],
        summary: 'short',
      }),
      null
    )

    assert.isTrue(errors.some((e) => e.includes('/summary')))
  })

  test('catches unknown techniques and pairs once the schema passes', async ({ assert }) => {
    const { errors } = await drafts.check(
      newProblem({
        answers: {
          subjects: [{ id: 'dp', role: 'intended' }],
          techniques: [{ id: 'dp.nope', role: 'intended' }],
        },
        pairWith: ['fx-missing'],
      }),
      null
    )

    assert.includeMembers(errors, [
      'answers.techniques: unknown technique dp.nope',
      'pairWith: unknown problem fx-missing',
    ])
  })

  test('ids are unique, except for the problem being edited', async ({ assert }) => {
    const taken = newProblem({ id: 'fx-coins' })

    const asNew = await drafts.check(taken, null)
    const asEdit = await drafts.check(taken, 'fx-coins')

    assert.isTrue(asNew.errors.some((e) => e.includes('already taken')))
    assert.isFalse(asEdit.errors.some((e) => e.includes('already taken')))
  })

  test('warns (never rejects) when the statement names the technique', async ({ assert }) => {
    const summary = 'Use dynamic programming over the number of steps to count the ways.'

    const ready = await drafts.check(newProblem({ summary }), null)

    // Statements are copied exactly, so they can't be reworded around a word.
    assert.deepEqual(ready.errors, [])
    assert.isTrue(ready.warnings.some((w) => w.includes('"dynamic programming"')))
  })

  test('checks the URL against the allowlist', async ({ assert }) => {
    const { errors } = await drafts.check(newProblem({ url: 'https://example.com/p/1' }), null)

    assert.isTrue(errors.some((e) => e.includes('allowlist')))
  })

  test('links to a pre-filled new file on GitHub, or the edit page', async ({ assert }) => {
    const created = await drafts.preview(newProblem(), null)
    const edited = await drafts.preview(await fixture(COINS), 'fx-coins')

    assert.isTrue(created.github?.prefilled)
    assert.match(created.github!.url, /\/new\/main\/problems\/dp\?filename=fx-new\.json&value=/)
    assert.isFalse(edited.github?.prefilled)
    assert.match(edited.github!.url, /\/edit\/main\/problems\/dp\/fx-coins\.json$/)
  })

  test('loads an existing problem for edit mode', async ({ assert }) => {
    const loaded = await drafts.load('fx-coins')

    assert.equal(loaded?.title, 'Fixture Coins')
    assert.isNull(await drafts.load('nope'))
  })

  test('reads the dropdown choices from the schema', async ({ assert }) => {
    const choices = await drafts.choices()

    assert.include(choices.sources, 'Codeforces')
    assert.include(choices.kinds, 'dp-state')
    assert.deepEqual(choices.tiers, ['easy', 'medium', 'hard'])
  })
})

/**
 * Every real problem file must survive the form unchanged, so edit mode never
 * reformats anything. Runs locally; skipped in CI.
 */
const REPO = resolve(fileURLToPath(app.appRoot), '../cp-trainer-content')

test('every real problem file round-trips through the form', async ({ assert }) => {
  const drafts = await app.container.make(ProblemDraft)
  const mismatches: string[] = []
  for (const subject of await readdir(join(REPO, 'problems'))) {
    for (const file of await readdir(join(REPO, 'problems', subject))) {
      const original = await readFile(join(REPO, 'problems', subject, file), 'utf8')
      const rebuilt = drafts.toJson(drafts.fromForm(formFields(JSON.parse(original))))
      if (rebuilt !== original) mismatches.push(`${subject}/${file}`)
    }
  }
  assert.deepEqual(mismatches, [])
}).skip(
  !existsSync(join(REPO, 'taxonomy.json')),
  'cp-trainer-content is not checked out next to the app'
)
