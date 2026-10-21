import { DrillAttemptSchema } from '#database/schema'
import { jsonColumn } from '#database/column_types'
import type { DrillKind } from '#types/drills'
import type { Outcome } from '#types/play'
import { column } from '@adonisjs/lucid/orm'

/**
 * What a player did on one drill of a lesson. `params` is what was asked
 * (n, complexity, options…) and `answer` the right option id, so the record
 * stays meaningful if the Big O table changes later.
 */
export default class DrillAttempt extends DrillAttemptSchema {
  declare kind: DrillKind
  declare outcome: Outcome

  @column(jsonColumn)
  declare params: Record<string, unknown>
}
