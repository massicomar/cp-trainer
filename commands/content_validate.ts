import { resolve } from 'node:path'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import contentConfig from '#config/content'
import ContentLoader from '#services/content_loader'

export default class ContentValidate extends BaseCommand {
  static commandName = 'content:validate'
  static description = 'Check the content repo against its schemas, without touching the database'
  static options: CommandOptions = {}

  @flags.string({ description: 'Content repo to check (defaults to CONTENT_DIR)' })
  declare dir?: string

  async run() {
    const root = this.dir ? resolve(this.dir) : contentConfig.dir
    const result = await new ContentLoader().load(root)

    if (!result.ok) {
      for (const issue of result.errors) this.logger.error(`${issue.file}: ${issue.message}`)
      this.logger.error(`${result.errors.length} error(s) in ${root}`)
      this.exitCode = 1
      return
    }

    const { taxonomy, problems } = result.content
    const ready = problems.filter(({ problem }) => problem.status === 'ready').length
    this.logger.success(
      `${root}: ${taxonomy.subjects.length} subjects, ${problems.length} problems ` +
        `(${ready} ready, ${problems.length - ready} draft)`
    )
  }
}
