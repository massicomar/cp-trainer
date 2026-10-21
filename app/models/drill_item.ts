import { DrillItemSchema } from '#database/schema'
import { booleanColumn, jsonColumn } from '#database/column_types'
import type { BigOTableData, AlgorithmData } from '#types/drills'
import { column } from '@adonisjs/lucid/orm'

/**
 * Drill content from the content repo's drills/ folder (D-065):
 * - "general:big-o", kind "big-o": the Big O table the generated drills use;
 * - "<subject>:<id>", kind "algorithm": one algorithm and its complexity.
 */
export default class DrillItem extends DrillItemSchema {
  static selfAssignPrimaryKey = true

  declare kind: 'big-o' | 'algorithm'

  @column(jsonColumn)
  declare data: BigOTableData | AlgorithmData

  @column(booleanColumn)
  declare deprecated: boolean
}
