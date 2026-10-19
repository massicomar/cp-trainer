import { ProblemSchema } from '#database/schema'
import { booleanColumn, jsonColumn } from '#database/column_types'
import Layer from '#models/layer'
import type { ProblemStatus, Tier } from '#types/content'
import { column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'

/**
 * One problem file from the content repo. `title` and `url` stay hidden from
 * the player until the problem is finished.
 */
export default class Problem extends ProblemSchema {
  static selfAssignPrimaryKey = true

  declare status: ProblemStatus
  declare tier: Tier

  @column(booleanColumn)
  declare constraintsVerified: boolean

  @column(jsonColumn)
  declare traps: string[]

  @column(jsonColumn)
  declare pairWith: string[]

  @column(jsonColumn)
  declare distractors: string[]

  @column(booleanColumn)
  declare deprecated: boolean

  @hasMany(() => Layer)
  declare layers: HasMany<typeof Layer>
}
