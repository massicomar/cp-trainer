import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import env from '#start/env'
import { dbPath } from '#config/database'
import { backupDatabase } from '#services/database_backup'

/**
 * node ace db:backup — a consistent copy of the live database, safe while the
 * app runs. On the VPS, scripts/backup.sh runs it nightly from cron.
 */
export default class DbBackup extends BaseCommand {
  static commandName = 'db:backup'
  static description = 'Copy the SQLite database to the backups folder and delete old copies'
  static options: CommandOptions = {}

  @flags.string({ description: 'Folder for backups (defaults to BACKUP_DIR, else tmp/backups)' })
  declare dir?: string

  @flags.number({ description: 'Delete backups older than this many days', default: 14 })
  declare keep: number

  async run() {
    const dir = resolve(
      fileURLToPath(this.app.appRoot),
      this.dir ?? env.get('BACKUP_DIR', 'tmp/backups')
    )
    try {
      const result = await backupDatabase({ dbPath, dir, keepDays: this.keep })
      const kb = Math.round(result.bytes / 1024)
      this.logger.success(`backup written: ${result.file} (${kb} KB, integrity ok)`)
      if (result.pruned.length) {
        this.logger.info(`deleted ${result.pruned.length} older than ${this.keep} days`)
      }
    } catch (error) {
      const message = (error as Error).message
      this.logger.error(`backup failed: ${message}`)
      if (/EACCES|permission/i.test(message)) {
        this.logger.error(
          `the backups folder must be writable by the app (in Docker: chown 1000:1000)`
        )
      }
      this.exitCode = 1
    }
  }
}
