import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Who added a problem, whether it's official or community, and whether a
 * lesson draws community problems. The defaults only cover rows that exist
 * before the next `content:sync` fills in the real values.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('problems', (table) => {
      table.string('author').notNullable().defaultTo('')
      table.string('collection').notNullable().defaultTo('official') // 'official' | 'community'
    })
    this.schema.alterTable('lessons', (table) => {
      table.boolean('include_community').notNullable().defaultTo(true)
    })
  }

  async down() {
    this.schema.alterTable('lessons', (table) => {
      table.dropColumn('include_community')
    })
    this.schema.alterTable('problems', (table) => {
      table.dropColumn('collection')
      table.dropColumn('author')
    })
  }
}
