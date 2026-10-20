import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import contentConfig from '#config/content'
import type { ProblemFile } from '#types/content'
import { FIXTURE_DIR, syncFixtureContent } from '#tests/helpers/content_fixture'
import { flattenFields, formFields } from '#tests/helpers/problem_form'

async function coins(): Promise<ProblemFile> {
  return JSON.parse(await readFile(join(FIXTURE_DIR, 'problems/dp/fx-coins.json'), 'utf8'))
}

test.group('Contribute page', (group) => {
  const originalDir = contentConfig.dir

  group.each.setup(async () => {
    const truncate = await testUtils.db().truncate()
    await syncFixtureContent()
    contentConfig.dir = FIXTURE_DIR
    return async () => {
      contentConfig.dir = originalDir
      await truncate()
    }
  })

  test('renders the form with the taxonomy', async ({ client }) => {
    const response = await client.get('/contribute')

    response.assertStatus(200)
    response.assertTextIncludes('Contribute a problem')
    response.assertTextIncludes('Coin change')
    response.assertTextIncludes('<optgroup label="Dynamic Programming">')
    response.assertTextIncludes('Start with the id, title and summary')
  })

  test('starts from an existing problem with ?from=', async ({ client, assert }) => {
    const response = await client.get('/contribute').qs({ from: 'fx-coins' })

    assert.match(response.text(), /Editing\s*<strong>fx-coins<\/strong>/)
    response.assertTextIncludes('value="Fixture Coins"')
    response.assertTextIncludes('problems/dp/fx-coins.json')
  })

  test('says so when the problem to edit does not exist', async ({ client }) => {
    const response = await client.get('/contribute').qs({ from: 'nope' })

    response.assertTextIncludes('There’s no problem with the id')
  })

  test('previews a new problem as you type (HTMX)', async ({ client, assert }) => {
    const problem = { ...(await coins()), id: 'fx-coins-2', title: 'Another one' }

    const response = await client
      .post('/contribute')
      .form(flattenFields(formFields(problem)))
      .header('HX-Request', 'true')
      .withCsrfToken()

    response.assertStatus(200)
    assert.notInclude(response.text(), '<html')
    response.assertTextIncludes('problems/dp/fx-coins-2.json')
    response.assertTextIncludes('Looks good')
    response.assertTextIncludes('&quot;id&quot;: &quot;fx-coins-2&quot;')
    response.assertTextIncludes('Open on GitHub')
  })

  test('lists what CI would reject', async ({ client }) => {
    const problem = {
      ...(await coins()),
      id: 'fx-coins-3',
      url: 'https://example.com/problems/3',
      summary: 'A classic knapsack: pick coins to reach the sum with as few as possible.',
    }

    const response = await client
      .post('/contribute')
      .form(flattenFields(formFields(problem)))
      .header('HX-Request', 'true')
      .withCsrfToken()

    response.assertTextIncludes('CI would reject this file')
    response.assertTextIncludes('allowlist')
    // Technique words in the statement are only a warning.
    response.assertTextIncludes('the statement names the technique')
  })

  test('without HTMX, a submit renders the whole page with the form as typed', async ({
    client,
  }) => {
    const problem = { ...(await coins()), id: 'fx-coins-4', title: 'Typed title' }

    const response = await client
      .post('/contribute')
      .form(flattenFields(formFields(problem)))
      .withCsrfToken()

    response.assertStatus(200)
    response.assertTextIncludes('<html')
    response.assertTextIncludes('value="Typed title"')
    response.assertTextIncludes('problems/dp/fx-coins-4.json')
  })
})
