import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import contentConfig from '#config/content'
import StatementImport from '#services/statement_import'
import type { ProblemFile } from '#types/content'
import { FIXTURE_DIR, syncFixtureContent } from '#tests/helpers/content_fixture'
import { flattenFields, formFields } from '#tests/helpers/problem_form'

async function coins(): Promise<ProblemFile> {
  return JSON.parse(await readFile(join(FIXTURE_DIR, 'problems/dp/fx-coins.json'), 'utf8'))
}

/** The importer with the judges' pages served from tests/fixtures/judges. */
async function fakeJudges() {
  const service = await app.container.make(StatementImport)
  service.fetchHtml = async (url) => {
    const judge = new URL(url).host.split('.').at(-2)!
    return readFile(new URL(`../fixtures/judges/${judge}.html`, import.meta.url), 'utf8')
  }
  app.container.swap(StatementImport, () => service)
}

test.group('Contribute page', (group) => {
  const originalDir = contentConfig.dir

  group.each.setup(async () => {
    const truncate = await testUtils.db().truncate()
    await syncFixtureContent()
    contentConfig.dir = FIXTURE_DIR
    return async () => {
      contentConfig.dir = originalDir
      app.container.restore(StatementImport)
      await truncate()
    }
  })

  test('starts with a choice: from a link, manual, or edit', async ({ client }) => {
    const response = await client.get('/contribute')

    response.assertStatus(200)
    response.assertTextIncludes('From a link')
    response.assertTextIncludes('action="/contribute/import"')
    response.assertTextIncludes('href="/contribute?new=1"')
    response.assertTextIncludes('<option value="fx-coins">')
  })

  test('follows the UI language; the file stays English', async ({ client, assert }) => {
    const start = await client.get('/contribute').withPlainCookie('locale', 'es')
    start.assertTextIncludes('Contribuir un problema')
    start.assertTextIncludes('Desde un enlace')

    const form = await client
      .get('/contribute')
      .qs({ from: 'fx-coins' })
      .withPlainCookie('locale', 'es')
    form.assertTextIncludes('Lo que lee el jugador')
    form.assertTextIncludes('Explicación en español')
    form.assertTextIncludes('El archivo')
    assert.match(form.text(), /Editando\s*<strong>fx-coins<\/strong>/)
    // The generated JSON is the same in any language.
    form.assertTextIncludes('&quot;explanation&quot;: &quot;Unbounded coins')

    const invalid = await client
      .post('/contribute/import')
      .form({ url: 'https://example.com/problems/1' })
      .withPlainCookie('locale', 'es')
      .withCsrfToken()
    invalid.assertTextIncludes('Ese no es un enlace a un problema de CSES')
  })

  test('renders the form with the taxonomy', async ({ client }) => {
    const response = await client.get('/contribute').qs({ new: 1 })

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

  test('a CSES / AtCoder / Kattis link comes back with the statement filled in', async ({
    client,
  }) => {
    await fakeJudges()

    const response = await client
      .post('/contribute/import')
      .form({ url: 'https://open.kattis.com/problems/polygonarea' })
      .withCsrfToken()

    response.assertStatus(200)
    response.assertTextIncludes('Imported from Kattis')
    response.assertTextIncludes('value="kattis-polygonarea"')
    response.assertTextIncludes('value="Polygon Area"')
    response.assertTextIncludes('Compute the area of a simple polygon')
  })

  test('a Codeforces link opens the form with only the id, judge and link', async ({
    client,
    assert,
  }) => {
    await fakeJudges()

    const response = await client
      .post('/contribute/import')
      .form({ url: 'https://codeforces.com/problemset/problem/455/A' })
      .withCsrfToken()

    response.assertTextIncludes('Codeforces blocks automatic fetching')
    response.assertTextIncludes('value="cf-455a"')
    assert.notInclude(response.text(), 'Boredom')
  })

  test('a link to a problem in the bank opens it to edit', async ({ client, assert }) => {
    const row = await db.from('problems').where('id', 'fx-coins').firstOrFail()
    await db.table('problems').insert({ ...row, id: 'cses-1634' })

    const response = await client
      .post('/contribute/import')
      .form({ url: 'https://cses.fi/problemset/task/1634' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/contribute?from=cses-1634')
  })

  test('any other link goes back to the start with an error', async ({ client }) => {
    const response = await client
      .post('/contribute/import')
      .form({ url: 'https://example.com/problems/1' })
      .withCsrfToken()

    response.assertTextIncludes('That isn’t a problem link from CSES')
    response.assertTextIncludes('From a link')
  })
})
