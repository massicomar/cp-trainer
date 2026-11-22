import { test } from '@japa/runner'
import edge from 'edge.js'

test.group('Error pages', () => {
  test('the 404 page renders without the router middleware', async ({ assert }) => {
    // Unmatched URLs never reach Shield, so there is no csrfField helper,
    // no request and no theme: the layout must still render.
    const html = await edge.render('pages/errors/not_found', {})

    assert.include(html, '404')
    assert.include(html, 'data-theme="system"')
    assert.notInclude(html, 'action="/preferences"')
  })

  test('the 500 page renders without the router middleware', async ({ assert }) => {
    const html = await edge.render('pages/errors/server_error', {})

    assert.include(html, '500')
  })
})
