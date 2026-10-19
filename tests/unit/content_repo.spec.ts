import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import ContentLoader from '#services/content_loader'
import { FIXTURE_DIR } from '#tests/helpers/content_fixture'

/**
 * Checks against the real cp-trainer-content checkout next to the app. They
 * run locally and skip in CI, where only this repo is checked out.
 */
const REPO = resolve(fileURLToPath(app.appRoot), '../cp-trainer-content')
const missing = !existsSync(join(REPO, 'taxonomy.json'))
const reason = 'cp-trainer-content is not checked out next to the app'

test.group('Content repo checkout', () => {
  test('fixture schemas are copies of the repo schemas', async ({ assert }) => {
    for (const name of ['problem.schema.json', 'taxonomy.schema.json']) {
      const real = await readFile(join(REPO, 'schema', name), 'utf8')
      const copy = await readFile(join(FIXTURE_DIR, 'schema', name), 'utf8')
      assert.equal(copy, real, `${name} differs; run npm run fixtures:schema`)
    }
  }).skip(missing, reason)

  test('the real content validates', async ({ assert }) => {
    const result = await new ContentLoader().load(REPO)

    assert.deepEqual(result.ok ? [] : result.errors, [])
  }).skip(missing, reason)
})
