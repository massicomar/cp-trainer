import { TechniqueSchema } from '#database/schema'
import { booleanColumn, jsonColumn } from '#database/column_types'
import Subject from '#models/subject'
import { belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

/**
 * A technique from taxonomy.json. Ids are "<subject>.<slug>", e.g. "dp.bitmask".
 */
export default class Technique extends TechniqueSchema {
  static selfAssignPrimaryKey = true

  @column(jsonColumn)
  declare confusableWith: string[]

  @column(booleanColumn)
  declare deprecated: boolean

  @belongsTo(() => Subject)
  declare subject: BelongsTo<typeof Subject>
}
