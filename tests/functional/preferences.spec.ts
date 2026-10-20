import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { syncFixtureContent } from '#tests/helpers/content_fixture'

test.group('Language and theme', (group) => {
  group.each.setup(async () => {
    const truncate = await testUtils.db().truncate()
    await syncFixtureContent()
    return truncate
  })

  test('English by default', async ({ client }) => {
    const response = await client.get('/')

    response.assertTextIncludes('<html lang="en"')
    response.assertTextIncludes('What do you want to practice?')
  })

  test("follows the browser's language", async ({ client }) => {
    const response = await client.get('/').header('Accept-Language', 'es-AR,es;q=0.9,en;q=0.5')

    response.assertTextIncludes('<html lang="es"')
    response.assertTextIncludes('¿Qué quieres practicar?')
    response.assertTextIncludes('Empezar lección')
  })

  test('the language switch wins over the browser', async ({ client }) => {
    const response = await client
      .get('/')
      .header('Accept-Language', 'es')
      .withPlainCookie('locale', 'en')

    response.assertTextIncludes('What do you want to practice?')
  })

  test('translates the live count, with plurals', async ({ client }) => {
    const one = await client
      .get('/selection/count')
      .qs({ subjects: ['graphs'], tiers: ['hard'] })
      .withPlainCookie('locale', 'es')
    const none = await client
      .get('/selection/count')
      .qs({ subjects: ['number-theory'], tiers: ['easy'] })
      .withPlainCookie('locale', 'es')

    one.assertTextIncludes('1 problema coincide')
    none.assertTextIncludes('Todavía no hay problemas para esta selección.')
  })

  test('saves the chosen language and theme in cookies', async ({ client, assert }) => {
    const response = await client
      .post('/preferences')
      .form({ theme: 'dark', locale: 'es' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    const cookies = String(response.header('set-cookie'))
    assert.include(cookies, 'theme=')
    assert.include(cookies, 'locale=')
  })

  test('ignores unknown values', async ({ client, assert }) => {
    const response = await client
      .post('/preferences')
      .form({ theme: 'neon', locale: 'fr' })
      .withCsrfToken()
      .redirects(0)

    assert.notInclude(String(response.header('set-cookie') ?? ''), 'theme=')
  })

  test('renders the chosen theme on <html>', async ({ client }) => {
    const system = await client.get('/')
    const dark = await client.get('/').withPlainCookie('theme', 'dark')

    system.assertTextIncludes('data-theme="system"')
    dark.assertTextIncludes('data-theme="dark"')
  })
})
