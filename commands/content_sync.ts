import { resolve } from 'node:path'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import contentConfig from '#config/content'
import ContentSync from '#services/content_sync'

export default class ContentSyncCommand extends BaseCommand {
  static commandName = 'content:sync'
  static description = 'Validate the content repo and copy it into the database (all or nothing)'
  static options: CommandOptions = { startApp: true }

  @flags.string({ description: 'Content repo to sync (defaults to CONTENT_DIR)' })
  declare dir?: string

  async run() {
    const root = this.dir ? resolve(this.dir) : contentConfig.dir
    const sync = await this.app.container.make(ContentSync)
    const result = await sync.syncDirectory(root)

    if (!result.ok) {
      for (const issue of result.errors) this.logger.error(`${issue.file}: ${issue.message}`)
      this.logger.error(`${result.errors.length} error(s) in ${root}; the database was not changed`)
      this.exitCode = 1
      return
    }

    const { subjects, techniques, problems, layers } = result.report
    this.logger.success(`synced ${root}`)
    this.logger.info(`${subjects} subjects, ${techniques} techniques`)
    this.logger.info(
      `${problems.total} problems (${problems.ready} ready, ${problems.draft} draft, ` +
        `${problems.retired} retired): ${problems.added} added, ${problems.changed} changed, ` +
        `${problems.unchanged} unchanged, ${problems.missing} no longer in the repo`
    )
    this.logger.info(`${layers.active} layers, ${layers.deprecated} newly deprecated`)
  }
}
