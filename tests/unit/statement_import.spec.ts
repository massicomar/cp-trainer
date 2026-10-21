import { readFile } from 'node:fs/promises'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import StatementImport, { parseProblemUrl } from '#services/statement_import'
import { syncFixtureContent } from '#tests/helpers/content_fixture'

const page = (name: string) =>
  readFile(new URL(`../fixtures/judges/${name}.html`, import.meta.url), 'utf8')

test.group('parseProblemUrl', () => {
  test('maps judge URLs to the bank’s id convention', ({ assert }) => {
    assert.deepEqual(parseProblemUrl('https://cses.fi/problemset/task/1158'), {
      judge: 'CSES',
      id: 'cses-1158',
      url: 'https://cses.fi/problemset/task/1158',
    })
    assert.deepEqual(parseProblemUrl('https://atcoder.jp/contests/dp/tasks/dp_e?lang=en'), {
      judge: 'AtCoder',
      id: 'atcoder-dp-e',
      url: 'https://atcoder.jp/contests/dp/tasks/dp_e',
    })
    assert.equal(
      parseProblemUrl('https://atcoder.jp/contests/abc178/tasks/abc178_e')?.id,
      'atcoder-abc178-e'
    )
    assert.equal(
      parseProblemUrl('https://open.kattis.com/problems/polygonarea')?.id,
      'kattis-polygonarea'
    )
    assert.deepEqual(parseProblemUrl('https://codeforces.com/problemset/problem/166/B'), {
      judge: 'Codeforces',
      id: 'cf-166b',
      url: 'https://codeforces.com/problemset/problem/166/B',
    })
    assert.equal(parseProblemUrl('https://codeforces.com/contest/1077/problem/F2')?.id, 'cf-1077f2')
    assert.deepEqual(parseProblemUrl('https://www.spoj.com/problems/PON/'), {
      judge: 'SPOJ',
      id: 'spoj-pon',
      url: 'https://www.spoj.com/problems/PON/',
    })
  })

  test('rejects anything that isn’t a problem page of a supported judge', ({ assert }) => {
    for (const url of [
      'not a url',
      'https://example.com/problemset/task/1158',
      'https://cses.fi/problemset/',
      'https://codeforces.com/gym/100001/problem/A',
      'ftp://cses.fi/problemset/task/1158',
      'http://localhost:3333/health',
    ]) {
      assert.isNull(parseProblemUrl(url), url)
    }
  })
})

test.group('StatementImport', (group) => {
  group.each.setup(async () => {
    const truncate = await testUtils.db().truncate()
    await syncFixtureContent()
    return truncate
  })

  async function importer(fetchHtml: (url: string) => Promise<string>) {
    const service = await app.container.make(StatementImport)
    service.fetchHtml = fetchHtml
    return service
  }

  test('fills the draft from a fetchable judge', async ({ assert }) => {
    const fetched: string[] = []
    const service = await importer(async (url) => {
      fetched.push(url)
      return page('atcoder')
    })

    const result = await service.import('https://atcoder.jp/contests/dp/tasks/dp_a')

    assert.deepEqual(fetched, ['https://atcoder.jp/contests/dp/tasks/dp_a?lang=en'])
    assert.equal(result.kind, 'fetched')
    if (result.kind !== 'fetched') return
    assert.include(result.draft, {
      id: 'atcoder-dp-a',
      source: 'AtCoder',
      title: 'Frog 1',
      status: 'draft',
      collection: 'community',
    })
    assert.include(result.draft.summary, '$|h_i - h_j|$')
    assert.isTrue(result.draft.constraints.verified)
  })

  test('Codeforces / SPOJ go to the manual form without fetching', async ({ assert }) => {
    const service = await importer(async () => {
      throw new Error('must not fetch')
    })

    const result = await service.import('https://codeforces.com/problemset/problem/455/A')

    assert.equal(result.kind, 'manual')
    if (result.kind !== 'manual') return
    assert.equal(result.reason, 'blocked')
    assert.include(result.draft, { id: 'cf-455a', source: 'Codeforces', summary: '' })
  })

  test('a failed fetch still gives the manual form with what the URL says', async ({ assert }) => {
    const service = await importer(async () => {
      throw new Error('timeout')
    })

    const result = await service.import('https://cses.fi/problemset/task/1633')

    assert.deepEqual(result.kind === 'manual' && result.reason, 'failed')
  })

  test('a problem already in the bank opens in edit mode', async ({ assert }) => {
    const row = await db.from('problems').where('id', 'fx-bfs').firstOrFail()
    await db.table('problems').insert({ ...row, id: 'cses-1667' })
    const service = await importer(async () => {
      throw new Error('must not fetch')
    })

    assert.deepEqual(await service.import('https://cses.fi/problemset/task/1667'), {
      kind: 'existing',
      id: 'cses-1667',
    })
  })

  test('other URLs are refused before any request', async ({ assert }) => {
    const service = await importer(async () => {
      throw new Error('must not fetch')
    })

    assert.deepEqual(await service.import('http://169.254.169.254/latest/meta-data'), {
      kind: 'invalid',
    })
  })
})
