import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Content tables. They're an index of the cp-trainer-content repo, rebuilt by
 * `node ace content:sync`. Rows are never deleted (attempts will reference
 * problems and layers); things that disappear from the repo are marked
 * `deprecated` instead.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('subjects', (table) => {
      table.string('id').primary()
      table.string('name').notNullable()
      table.integer('position').notNullable()
      table.boolean('hidden').notNullable().defaultTo(false)
      table.boolean('deprecated').notNullable().defaultTo(false)
    })

    this.schema.createTable('techniques', (table) => {
      table.string('id').primary()
      table.string('subject_id').notNullable().references('id').inTable('subjects')
      table.string('name').notNullable()
      table.integer('position').notNullable()
      table.json('confusable_with').notNullable()
      table.boolean('deprecated').notNullable().defaultTo(false)
    })

    this.schema.createTable('problems', (table) => {
      table.string('id').primary()
      table.string('status').notNullable()
      table.string('title').notNullable()
      table.string('source').notNullable()
      table.string('url').notNullable()
      table.string('tier').notNullable()
      table.string('difficulty_scale').notNullable()
      table.string('difficulty_value').notNullable()
      table.text('summary_md').notNullable()
      table.text('constraints_text').notNullable()
      table.boolean('constraints_verified').notNullable()
      table.text('explanation_md').notNullable()
      table.json('traps').notNullable()
      table.json('pair_with').notNullable()
      table.json('distractors').notNullable()
      table.boolean('deprecated').notNullable().defaultTo(false)
      table.string('source_path').notNullable()
      table.string('content_hash').notNullable()
      table.timestamp('synced_at').notNullable()

      table.index(['status', 'deprecated', 'tier'])
    })

    /**
     * Which sessions a problem belongs to: its intended subject, accepted
     * subjects that have a technique of their own, and `appearsIn`.
     */
    this.schema.createTable('problem_subjects', (table) => {
      table.string('problem_id').notNullable().references('id').inTable('problems')
      table.string('subject_id').notNullable().references('id').inTable('subjects')
      table.string('role').nullable() // null when via = 'appearsIn'
      table.string('via').notNullable() // 'answer' | 'appearsIn'

      table.primary(['problem_id', 'subject_id'])
      table.index(['subject_id'])
    })

    /**
     * Every correct answer with its role, as written in the problem file.
     */
    this.schema.createTable('problem_answers', (table) => {
      table.string('problem_id').notNullable().references('id').inTable('problems')
      table.string('kind').notNullable() // 'subject' | 'technique'
      table.string('answer_id').notNullable()
      table.string('role').notNullable() // 'intended' | 'accepted' | 'overkill'

      table.primary(['problem_id', 'kind', 'answer_id'])
    })

    /**
     * Layer 1 (subject) and 2 (technique) are derived from the answers; their
     * options are built at play time. Layers 3+ are the file's extraLayers.
     */
    this.schema.createTable('layers', (table) => {
      table.string('id').primary() // "<problemId>:<key>"
      table.string('problem_id').notNullable().references('id').inTable('problems')
      table.integer('position').notNullable()
      table.string('kind').notNullable()
      table.text('prompt').notNullable()
      table.json('options').nullable()
      table.json('accepted').notNullable()
      table.text('explanation_md').nullable()
      table.boolean('deprecated').notNullable().defaultTo(false)

      table.index(['problem_id', 'position'])
    })
  }

  async down() {
    this.schema.dropTable('layers')
    this.schema.dropTable('problem_answers')
    this.schema.dropTable('problem_subjects')
    this.schema.dropTable('problems')
    this.schema.dropTable('techniques')
    this.schema.dropTable('subjects')
  }
}
