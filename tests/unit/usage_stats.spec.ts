import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import UsageStats from '#services/usage_stats'
import { syncFixtureContent } from '#tests/helpers/content_fixture'

const NOW = DateTime.fromISO('2026-11-22T12:00:00Z', { zone: 'utc' })

async function player(id: string, createdAt: string) {
  await db.table('players').insert({ id, created_at: createdAt, last_seen_at: createdAt })
}

async function round(
  playerId: string,
  subjects: string[],
  createdAt: string,
  finishedAt: string | null = null
) {
  const [id] = await db.table('lessons').insert({
    player_id: playerId,
    subject_ids: JSON.stringify(subjects),
    tiers: JSON.stringify(['easy']),
    problem_ids: JSON.stringify([]),
    layer_started_at: createdAt,
    status: finishedAt ? 'done' : 'active',
    created_at: createdAt,
    finished_at: finishedAt,
  })
  return Number(id)
}

test.group('UsageStats', (group) => {
  const stats = new UsageStats()
  let layer: { id: string; problem_id: string }

  group.each.setup(async () => {
    const truncate = await testUtils.db().truncate()
    await syncFixtureContent()
    layer = await db.from('layers').select('id', 'problem_id').firstOrFail()
    return () => truncate()
  })

  async function answer(playerId: string, lessonId: number, createdAt: string) {
    await db.table('attempts').insert({
      player_id: playerId,
      lesson_id: lessonId,
      layer_id: layer.id,
      problem_id: layer.problem_id,
      chosen: 'a',
      outcome: 'correct',
      created_at: createdAt,
    })
  }

  async function drill(playerId: string, lessonId: number, index: number, createdAt: string) {
    await db.table('drill_attempts').insert({
      player_id: playerId,
      lesson_id: lessonId,
      item_index: index,
      kind: 'fits',
      params: JSON.stringify({}),
      answer: 'yes',
      chosen: 'yes',
      outcome: 'correct',
      created_at: createdAt,
    })
  }

  test('counts players, rounds and answers per day, with every day in the range', async ({
    assert,
  }) => {
    await player('old', '2026-09-01 10:00:00')
    await round('old', ['dp'], '2026-09-01 10:01:00', '2026-09-01 10:20:00')

    await player('ana', '2026-11-20 10:00:00')
    const first = await round('ana', ['dp'], '2026-11-20 10:05:00', '2026-11-20 10:20:00')
    await answer('ana', first, '2026-11-20 10:06:00')
    await drill('ana', first, 1, '2026-11-20 10:10:00')

    await player('bo', '2026-11-21 23:30:00')
    const second = await round('bo', ['dp', 'graphs'], '2026-11-21 23:35:00')
    await answer('bo', second, '2026-11-21 23:40:00')

    const report = await stats.report({ days: 3, now: NOW })

    assert.deepEqual(report.days, [
      {
        day: '2026-11-20',
        newPlayers: 1,
        activePlayers: 1,
        roundsStarted: 1,
        roundsFinished: 1,
        answers: 2,
      },
      {
        day: '2026-11-21',
        newPlayers: 1,
        activePlayers: 1,
        roundsStarted: 1,
        roundsFinished: 0,
        answers: 1,
      },
      {
        day: '2026-11-22',
        newPlayers: 0,
        activePlayers: 0,
        roundsStarted: 0,
        roundsFinished: 0,
        answers: 0,
      },
    ])
    assert.deepEqual(report.totals, {
      newPlayers: 2,
      activePlayers: 2,
      roundsStarted: 2,
      roundsFinished: 1,
      answers: 3,
    })
    assert.deepEqual(report.allTime, { players: 3, roundsFinished: 2 })
    assert.deepEqual(report.subjects, [
      { id: 'dp', name: 'Dynamic Programming', rounds: 2 },
      { id: 'graphs', name: 'Graphs', rounds: 1 },
    ])
  })

  test('counts a player once per day and once in the totals', async ({ assert }) => {
    await player('ana', '2026-11-21 09:00:00')
    const a = await round('ana', ['dp'], '2026-11-21 09:01:00', '2026-11-21 09:30:00')
    const b = await round('ana', ['dp'], '2026-11-22 09:01:00')
    await answer('ana', a, '2026-11-21 09:02:00')
    await drill('ana', a, 1, '2026-11-21 09:03:00')
    await answer('ana', b, '2026-11-22 09:02:00')

    const report = await stats.report({ days: 2, now: NOW })

    assert.deepEqual(
      report.days.map((d) => [d.day, d.activePlayers, d.answers]),
      [
        ['2026-11-21', 1, 2],
        ['2026-11-22', 1, 1],
      ]
    )
    assert.equal(report.totals.activePlayers, 1)
  })

  test('cuts days in the given time zone; timestamps are stored in UTC', async ({ assert }) => {
    // 01:00 UTC on the 22nd is 22:00 on the 21st at UTC-3.
    await player('ana', '2026-11-22 01:00:00')

    const utc = await stats.report({ days: 2, now: NOW })
    const local = await stats.report({ days: 2, timezone: 'UTC-3', now: NOW })

    assert.deepEqual(
      utc.days.map((d) => [d.day, d.newPlayers]),
      [
        ['2026-11-21', 0],
        ['2026-11-22', 1],
      ]
    )
    assert.deepEqual(
      local.days.map((d) => [d.day, d.newPlayers]),
      [
        ['2026-11-21', 1],
        ['2026-11-22', 0],
      ]
    )
    assert.equal(local.timezone, 'UTC-3')
  })

  test('leaves out anything before the range', async ({ assert }) => {
    await player('ana', '2026-11-19 23:59:59')
    await round('ana', ['graphs'], '2026-11-19 23:59:59', '2026-11-20 00:00:01')

    const report = await stats.report({ days: 3, now: NOW })

    assert.equal(report.totals.newPlayers, 0)
    assert.equal(report.totals.roundsStarted, 0)
    // Finished inside the range, so it counts there.
    assert.equal(report.totals.roundsFinished, 1)
    assert.deepEqual(report.subjects, [])
  })

  test('knows which time zones are valid', ({ assert }) => {
    assert.isTrue(UsageStats.isValidZone('UTC'))
    assert.isTrue(UsageStats.isValidZone('Europe/Madrid'))
    assert.isTrue(UsageStats.isValidZone('UTC-3'))
    assert.isFalse(UsageStats.isValidZone('Mars/Olympus'))
  })
})
