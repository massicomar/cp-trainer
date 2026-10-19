import { test } from '@japa/runner'

test.group('Health', () => {
  test('reports ok when the database answers', async ({ client }) => {
    const response = await client.get('/health')

    response.assertStatus(200)
    response.assertBody({ status: 'ok' })
  })
})

test.group('Home', () => {
  test('renders the start page', async ({ client }) => {
    const response = await client.get('/')

    response.assertStatus(200)
    response.assertTextIncludes('CP Trainer')
  })
})
