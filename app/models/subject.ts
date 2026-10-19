import { SubjectSchema } from '#database/schema'
import { booleanColumn } from '#database/column_types'
import Technique from '#models/technique'
import { column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'

/**
 * A subject from taxonomy.json, e.g. "dp". Hidden subjects ("other") can be
 * correct answers but are never offered as a session choice.
 */
export default class Subject extends SubjectSchema {
  static selfAssignPrimaryKey = true

  @column(booleanColumn)
  declare hidden: boolean

  @column(booleanColumn)
  declare deprecated: boolean

  @hasMany(() => Technique)
  declare techniques: HasMany<typeof Technique>
}
