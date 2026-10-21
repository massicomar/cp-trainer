import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Drills (D-065): their content, the answers to them, and lessons as a list
 * of items (problems and drills) walked by one cursor.
 *
 * Existing lessons get `items` built from their problems and `cursor_item`
 * from `cursor_problem`, which this replaces.
 */
export default class extends BaseSchema {
  async up() {
    /**
     * Content, rebuilt by every sync like the other content tables:
     * - "general:big-o", kind "big-o": the Big O table generated drills use;
     * - "<subject>:<algorithm id>", kind "algorithm": one algorithm and its complexity.
     */
    this.schema.createTable('drill_items', (table) => {
      table.string('id').primary()
      table.string('subject_id').nullable().references('id').inTable('subjects')
      table.string('kind').notNullable()
      table.json('data').notNullable()
      table.boolean('deprecated').notNullable().defaultTo(false)
    })

    /**
     * One row per drill shown in a lesson, with what was asked (`params`) and
     * the right option, so history survives changes to the Big O table.
     */
    this.schema.createTable('drill_attempts', (table) => {
      table.increments('id')
      table.string('player_id').notNullable().references('id').inTable('players')
      table.integer('lesson_id').unsigned().notNullable().references('id').inTable('lessons')
      table.integer('item_index').notNullable()
      table.string('kind').notNullable() // max-big-o | algorithm-big-o | max-n | fits
      table.string('drill_item_id').nullable().references('id').inTable('drill_items')
      table.json('params').notNullable()
      table.string('answer').notNullable() // the right option id
      table.string('chosen').nullable() // null for gave_up / skipped
      table.string('outcome').notNullable() // correct | wrong | gave_up | skipped
      table.integer('ms_taken').nullable()
      table.timestamp('created_at').notNullable()

      table.unique(['lesson_id', 'item_index'])
      table.index(['player_id', 'kind'])
    })

    this.schema.alterTable('lessons', (table) => {
      table.boolean('include_drills').notNullable().defaultTo(false)
      // [{ type: 'problem', id } | { type: 'drill', kind, algorithmId? }]
      table.json('items').notNullable().defaultTo('[]')
      table.integer('cursor_item').notNullable().defaultTo(0)
    })

    this.defer(async (db) => {
      const lessons = await db.from('lessons').select('id', 'problem_ids', 'cursor_problem')
      for (const lesson of lessons) {
        const ids: string[] = JSON.parse(lesson.problem_ids)
        await db
          .from('lessons')
          .where('id', lesson.id)
          .update({
            items: JSON.stringify(ids.map((id) => ({ type: 'problem', id }))),
            cursor_item: lesson.cursor_problem,
          })
      }
      // Native DROP COLUMN (see the Spanish texts migration).
      await db.rawQuery('ALTER TABLE lessons DROP COLUMN cursor_problem')
    })
  }

  async down() {
    this.schema.alterTable('lessons', (table) => {
      table.integer('cursor_problem').notNullable().defaultTo(0)
    })
    this.defer(async (db) => {
      const lessons = await db.from('lessons').select('id', 'items', 'cursor_item')
      for (const lesson of lessons) {
        const items: { type: string }[] = JSON.parse(lesson.items)
        const before = items.slice(0, lesson.cursor_item).filter((i) => i.type === 'problem')
        await db.from('lessons').where('id', lesson.id).update({ cursor_problem: before.length })
      }
      await db.rawQuery('ALTER TABLE lessons DROP COLUMN cursor_item')
      await db.rawQuery('ALTER TABLE lessons DROP COLUMN items')
      await db.rawQuery('ALTER TABLE lessons DROP COLUMN include_drills')
      await db.schema.dropTable('drill_attempts')
      await db.schema.dropTable('drill_items')
    })
  }
}
