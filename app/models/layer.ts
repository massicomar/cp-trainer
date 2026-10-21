import { LayerSchema } from '#database/schema'
import { booleanColumn, jsonColumn } from '#database/column_types'
import Problem from '#models/problem'
import type { StoredLayerOption } from '#types/content'
import { belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

/**
 * One question about a problem. Ids are stable ("cses-1158:dp-state") so
 * attempt history survives re-syncs.
 *
 * - kind "subject" / "technique": derived from the problem's answers;
 *   `options` is null because the choices are built at play time.
 *   `accepted` holds the intended + accepted subject or technique ids.
 * - any other kind: an authored extraLayer, with its options as written.
 */
export default class Layer extends LayerSchema {
  static selfAssignPrimaryKey = true

  @column(jsonColumn)
  declare options: StoredLayerOption[] | null

  @column(jsonColumn)
  declare accepted: string[]

  @column(booleanColumn)
  declare deprecated: boolean

  @belongsTo(() => Problem)
  declare problem: BelongsTo<typeof Problem>
}
