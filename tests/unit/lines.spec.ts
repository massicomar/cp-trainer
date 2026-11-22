import { test } from '@japa/runner'
import { lineOf } from '#services/lines'

test.group('lineOf', () => {
  test('gives each known subject its line code', ({ assert }) => {
    assert.deepEqual(lineOf('dp'), { id: 'dp', code: 'DP' })
    assert.deepEqual(lineOf('graphs'), { id: 'graphs', code: 'GR' })
    assert.deepEqual(lineOf('number-theory'), { id: 'number-theory', code: 'NT' })
  })

  test('still gives a badge to a subject it does not know, and to none', ({ assert }) => {
    assert.deepEqual(lineOf('strings'), { id: 'strings', code: 'ST' })
    assert.deepEqual(lineOf(null), { id: 'other', code: '—' })
  })
})
