import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Who plays and what they answered. Unlike the content tables, these are the
 * app's own data: they're never rebuilt, and they're what the backups protect.
 */
export default class extends BaseSchema {
  async up() {
    /**
     * Anonymous players, identified by a signed `pid` cookie. v2 accounts will
     * claim these rows.
     */
    this.schema.createTable('players', (table) => {
      table.string('id').primary() // uuid
      table.json('preferences').nullable() // { subjects: string[], tiers: string[] }
      table.timestamp('created_at').notNullable()
      table.timestamp('last_seen_at').notNullable()
    })

    /**
     * One lesson = up to 5 problems. The cursor is the lesson's state machine,
     * so a refresh always resumes at the same layer.
     */
    this.schema.createTable('lessons', (table) => {
      table.increments('id')
      table.string('player_id').notNullable().references('id').inTable('players')
      table.json('subject_ids').notNullable()
      table.json('tiers').notNullable()
      table.json('problem_ids').notNullable()
      table.integer('cursor_problem').notNullable().defaultTo(0)
      table.integer('cursor_layer').notNullable().defaultTo(0)
      // When the current layer was first shown; answers store ms_taken from it.
      table.timestamp('layer_started_at').notNullable()
      table.string('status').notNullable().defaultTo('active') // 'active' | 'done'
      table.timestamp('created_at').notNullable()
      table.timestamp('finished_at').nullable()

      table.index(['player_id', 'created_at'])
    })

    /**
     * One row per layer shown in a lesson. The unique key makes a double
     * submit harmless.
     */
    this.schema.createTable('attempts', (table) => {
      table.increments('id')
      table.string('player_id').notNullable().references('id').inTable('players')
      table.integer('lesson_id').unsigned().notNullable().references('id').inTable('lessons')
      table.string('layer_id').notNullable().references('id').inTable('layers')
      table.string('problem_id').notNullable().references('id').inTable('problems')
      table.string('chosen').nullable() // null for gave_up / skipped
      table.string('outcome').notNullable() // correct | overkill | wrong | gave_up | skipped
      table.integer('ms_taken').nullable()
      table.timestamp('created_at').notNullable()

      table.unique(['lesson_id', 'layer_id'])
      table.index(['player_id', 'problem_id'])
    })
  }

  async down() {
    this.schema.dropTable('attempts')
    this.schema.dropTable('lessons')
    this.schema.dropTable('players')
  }
}
