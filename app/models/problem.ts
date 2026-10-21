import { ProblemSchema } from '#database/schema'
import { booleanColumn, jsonColumn } from '#database/column_types'
import Layer from '#models/layer'
import type { Collection, ProblemStatus, Tier } from '#types/content'
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
  declare collection: Collection

  @column(booleanColumn)
  declare constraintsVerified: boolean

  @column(jsonColumn)
  declare traps: string[]

  /** Same order as `traps`; a missing or empty entry means the English one. */
  @column(jsonColumn)
  declare trapsEs: string[]

  @column(jsonColumn)
  declare pairWith: string[]

  @column(jsonColumn)
  declare distractors: string[]

  @column(booleanColumn)
  declare deprecated: boolean

  @hasMany(() => Layer)
  declare layers: HasMany<typeof Layer>
}
