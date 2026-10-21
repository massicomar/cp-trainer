import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Spanish versions of the texts that explain (the content's `es` block,
 * D-064). Null / empty means "show the English one". Each option's Spanish
 * `why` lives inside `layers.options` as `whyEs`.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('problems', (table) => {
      table.text('explanation_es').nullable()
      table.json('traps_es').notNullable().defaultTo('[]') // same order as traps
    })
    this.schema.alterTable('layers', (table) => {
      table.text('explanation_es').nullable()
    })
  }

  async down() {
    // Native DROP COLUMN: knex's SQLite fallback rebuilds the table, which the
    // foreign keys from attempts block once there's play history.
    this.schema.raw('ALTER TABLE layers DROP COLUMN explanation_es')
    this.schema.raw('ALTER TABLE problems DROP COLUMN traps_es')
    this.schema.raw('ALTER TABLE problems DROP COLUMN explanation_es')
  }
}
