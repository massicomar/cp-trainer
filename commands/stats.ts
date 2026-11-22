import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import env from '#start/env'
import UsageStats from '#services/usage_stats'

/**
 * node ace stats — who played, per day. On the VPS:
 * `docker compose exec app node ace stats --days 14`. Visits (including people
 * who never start a round) are in the Caddy report at /_stats/ instead (D-101).
 */
export default class Stats extends BaseCommand {
  static commandName = 'stats'
  static description = 'Usage per day: new players, players who played, rounds and answers'
  static options: CommandOptions = { startApp: true }

  @flags.number({ description: 'How many days back, today included', default: 30 })
  declare days: number

  @flags.string({
    description: 'Time zone that cuts the days (defaults to APP_TIMEZONE, else UTC)',
  })
  declare tz?: string

  @flags.boolean({ description: 'Also list the days with no activity', default: false })
  declare allDays: boolean

  async run() {
    const timezone = this.tz ?? env.get('APP_TIMEZONE') ?? 'UTC'
    if (!UsageStats.isValidZone(timezone)) {
      this.logger.error(`unknown time zone "${timezone}" (use an IANA name, e.g. Europe/Madrid)`)
      this.exitCode = 1
      return
    }
    if (!Number.isInteger(this.days) || this.days < 1) {
      this.logger.error('--days must be a whole number of at least 1')
      this.exitCode = 1
      return
    }

    const stats = await this.app.container.make(UsageStats)
    const report = await stats.report({ days: this.days, timezone })
    const first = report.days[0]?.day
    const last = report.days.at(-1)?.day

    this.logger.info(`last ${this.days} day(s), ${first} to ${last} (${timezone})`)

    const shown = this.allDays
      ? report.days
      : report.days.filter((d) => d.newPlayers || d.roundsStarted || d.roundsFinished || d.answers)

    if (shown.length) {
      const table = this.ui.table()
      table.head(['Day', 'New players', 'Played', 'Rounds', 'Finished', 'Answers'])
      for (const d of shown) {
        table.row([
          d.day,
          String(d.newPlayers),
          String(d.activePlayers),
          String(d.roundsStarted),
          String(d.roundsFinished),
          String(d.answers),
        ])
      }
      table.render()
      if (!this.allDays && shown.length < report.days.length) {
        this.logger.info(`days with no activity are hidden (--all-days shows them)`)
      }
    } else {
      this.logger.info('no activity in this range')
    }

    const t = report.totals
    this.logger.info(
      `in range: ${t.newPlayers} new player(s), ${t.activePlayers} played, ` +
        `${t.roundsStarted} round(s) started, ${t.roundsFinished} finished, ${t.answers} answer(s)`
    )
    this.logger.info(
      `all time: ${report.allTime.players} player(s), ${report.allTime.roundsFinished} round(s) finished`
    )
    if (report.subjects.length) {
      const list = report.subjects.map((s) => `${s.name} ${s.rounds}`).join(', ')
      this.logger.info(`rounds per subject in range: ${list}`)
    }
  }
}
