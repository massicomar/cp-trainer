import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Accounts (L2, plan §12.9). A user signs in with GitHub (or, locally, the
 * dev login) and owns exactly one player. Lessons, attempts and drill
 * attempts keep hanging off players, so none of them move.
 *
 * Lessons also keep the Custom options (plan §12.7): a technique filter, the
 * kinds of short questions, and drills-only rounds.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('users', (table) => {
      table.increments('id')
      table.string('provider').notNullable() // 'github' | 'dev'
      table.string('provider_id').notNullable()
      table.string('username').notNullable()
      table.string('display_name').nullable()
      table.string('avatar_url').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('last_login_at').notNullable()

      table.unique(['provider', 'provider_id'])
    })

    /**
     * No foreign key: SQLite can't drop a column that has one, and the
     * account code deletes the player together with its user anyway.
     */
    this.schema.alterTable('players', (table) => {
      table.integer('user_id').unsigned().nullable()
      table.unique(['user_id'])
    })

    this.schema.alterTable('lessons', (table) => {
      table.json('technique_ids').nullable() // null: every technique of the subjects
      table.json('drill_kinds').nullable() // null: every kind
      table.boolean('drills_only').notNullable().defaultTo(false)
    })
  }

  async down() {
    this.schema.alterTable('players', (table) => {
      table.dropUnique(['user_id'])
    })
    // Native DROP COLUMN (see the Spanish texts migration).
    this.defer(async (db) => {
      await db.rawQuery('ALTER TABLE players DROP COLUMN user_id')
      await db.rawQuery('ALTER TABLE lessons DROP COLUMN technique_ids')
      await db.rawQuery('ALTER TABLE lessons DROP COLUMN drill_kinds')
      await db.rawQuery('ALTER TABLE lessons DROP COLUMN drills_only')
      await db.schema.dropTable('users')
    })
  }
}
