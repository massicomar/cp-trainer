import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

/** One day of `node ace stats`. */
export interface DayUsage {
  /** yyyy-MM-dd in the report's time zone. */
  day: string
  newPlayers: number
  /** Players with at least one answer (problem layer or drill) that day. */
  activePlayers: number
  roundsStarted: number
  roundsFinished: number
  /** Answered, given-up and skipped questions, problems and drills together. */
  answers: number
}

export interface UsageReport {
  timezone: string
  days: DayUsage[]
  /** Over the whole range; `activePlayers` counts each player once. */
  totals: Omit<DayUsage, 'day'>
  allTime: { players: number; roundsFinished: number }
  /** Rounds started in the range that included each subject, most first. */
  subjects: { id: string; name: string; rounds: number }[]
}

export interface UsageOptions {
  days?: number
  timezone?: string
  /** For tests; defaults to the current time. */
  now?: DateTime
}

/** How Lucid writes timestamps in SQLite: UTC wall time, since the app runs with TZ=UTC. */
const SQL_FORMAT = 'yyyy-LL-dd HH:mm:ss'

/**
 * Usage numbers for `node ace stats`, from the play tables alone. Nothing new
 * is recorded for this: players, lessons (rounds), attempts and drill attempts
 * already carry their timestamps. Visits that never start a round don't create
 * a player (D-030), so traffic comes from the Caddy log instead (D-101).
 */
export default class UsageStats {
  /** True when Luxon knows the zone (an IANA name like "Europe/Madrid", "UTC", "UTC-3"). */
  static isValidZone(zone: string) {
    return DateTime.now().setZone(zone).isValid
  }

  async report({
    days = 30,
    timezone = 'UTC',
    now = DateTime.utc(),
  }: UsageOptions = {}): Promise<UsageReport> {
    const end = now.setZone(timezone)
    const start = end.minus({ days: Math.max(1, days) - 1 }).startOf('day')
    const since = start.toUTC().toFormat(SQL_FORMAT)
    const dayOf = (value: string) =>
      DateTime.fromSQL(value, { zone: 'utc' }).setZone(timezone).toISODate() ?? ''

    const rows = new Map<string, DayUsage>()
    const playersByDay = new Map<string, Set<string>>()
    for (let d = start; d <= end; d = d.plus({ days: 1 })) {
      const day = d.toISODate() ?? ''
      rows.set(day, {
        day,
        newPlayers: 0,
        activePlayers: 0,
        roundsStarted: 0,
        roundsFinished: 0,
        answers: 0,
      })
      playersByDay.set(day, new Set())
    }

    const [players, started, finished, attempts, drillAttempts, subjectNames] = await Promise.all([
      db.from('players').where('created_at', '>=', since).select('created_at'),
      db.from('lessons').where('created_at', '>=', since).select('created_at', 'subject_ids'),
      db.from('lessons').where('finished_at', '>=', since).select('finished_at'),
      db.from('attempts').where('created_at', '>=', since).select('created_at', 'player_id'),
      db.from('drill_attempts').where('created_at', '>=', since).select('created_at', 'player_id'),
      db.from('subjects').select('id', 'name'),
    ])

    const count = (value: string, field: Exclude<keyof DayUsage, 'day' | 'activePlayers'>) => {
      const row = rows.get(dayOf(value))
      if (row) row[field]++
    }

    for (const player of players) count(player.created_at, 'newPlayers')
    for (const lesson of finished) count(lesson.finished_at, 'roundsFinished')

    const subjectRounds = new Map<string, number>()
    for (const lesson of started) {
      count(lesson.created_at, 'roundsStarted')
      for (const id of parseIds(lesson.subject_ids)) {
        subjectRounds.set(id, (subjectRounds.get(id) ?? 0) + 1)
      }
    }

    const activeInRange = new Set<string>()
    for (const answer of [...attempts, ...drillAttempts]) {
      count(answer.created_at, 'answers')
      const day = dayOf(answer.created_at)
      if (playersByDay.has(day)) {
        playersByDay.get(day)!.add(answer.player_id)
        activeInRange.add(answer.player_id)
      }
    }
    for (const [day, ids] of playersByDay) rows.get(day)!.activePlayers = ids.size

    const list = [...rows.values()]
    const sum = (field: keyof Omit<DayUsage, 'day'>) => list.reduce((n, r) => n + r[field], 0)

    const [allPlayers, allFinished] = await Promise.all([
      db.from('players').count('* as n').first(),
      db.from('lessons').whereNotNull('finished_at').count('* as n').first(),
    ])

    const names = new Map<string, string>(subjectNames.map((s) => [s.id, s.name]))

    return {
      timezone,
      days: list,
      totals: {
        newPlayers: sum('newPlayers'),
        activePlayers: activeInRange.size,
        roundsStarted: sum('roundsStarted'),
        roundsFinished: sum('roundsFinished'),
        answers: sum('answers'),
      },
      allTime: {
        players: Number(allPlayers?.n ?? 0),
        roundsFinished: Number(allFinished?.n ?? 0),
      },
      subjects: [...subjectRounds.entries()]
        .map(([id, rounds]) => ({ id, name: names.get(id) ?? id, rounds }))
        .sort((a, b) => b.rounds - a.rounds || a.name.localeCompare(b.name)),
    }
  }
}

function parseIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
