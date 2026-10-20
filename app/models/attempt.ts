import { AttemptSchema } from '#database/schema'
import Layer from '#models/layer'
import type { Outcome } from '#types/play'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

/**
 * What a player did on one layer of one lesson. `chosen` is the option id
 * (subject id, technique id or authored letter), null for gave_up / skipped.
 */
export default class Attempt extends AttemptSchema {
  declare outcome: Outcome

  @belongsTo(() => Layer)
  declare layer: BelongsTo<typeof Layer>
}
