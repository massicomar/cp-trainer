import { LessonSchema } from '#database/schema'
import { booleanColumn, jsonColumn } from '#database/column_types'
import Attempt from '#models/attempt'
import Player from '#models/player'
import type { Tier } from '#types/content'
import type { DrillKind, LessonItem } from '#types/drills'
import type { Selection } from '#types/play'
import { belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

/**
 * Up to 5 problems drawn from a selection, with drills between them unless
 * the player turned them off (a "round" in the UI). A Custom round can also
 * be drills only. `items` is the order they're played in;
 * `cursorItem` indexes it and `cursorLayer` indexes the layers asked for the
 * current problem (see QuestionBuilder.steps). Both live in the row, so a
 * refresh resumes in place.
 */
export default class Lesson extends LessonSchema {
  declare status: 'active' | 'done'

  @column(jsonColumn)
  declare subjectIds: string[]

  @column(jsonColumn)
  declare tiers: Tier[]

  @column(jsonColumn)
  declare problemIds: string[]

  @column(booleanColumn)
  declare includeCommunity: boolean

  @column(booleanColumn)
  declare includeDrills: boolean

  @column(jsonColumn)
  declare items: LessonItem[]

  /** Custom: the techniques to draw from; null for all of them. */
  @column(jsonColumn)
  declare techniqueIds: string[] | null

  /** Custom: the kinds of short questions; null for all of them. */
  @column(jsonColumn)
  declare drillKinds: DrillKind[] | null

  /** Custom: short questions only, no problems. */
  @column(booleanColumn)
  declare drillsOnly: boolean

  @belongsTo(() => Player)
  declare player: BelongsTo<typeof Player>

  @hasMany(() => Attempt)
  declare attempts: HasMany<typeof Attempt>

  /** The Custom options appear only when set, as in a stored selection. */
  get selection(): Selection {
    const selection: Selection = {
      subjects: this.subjectIds,
      tiers: this.tiers,
      includeCommunity: this.includeCommunity,
      includeDrills: this.includeDrills,
    }
    if (this.drillsOnly) selection.drillsOnly = true
    if (this.techniqueIds) selection.techniques = this.techniqueIds
    if (this.drillKinds) selection.drillKinds = this.drillKinds
    return selection
  }

  get isDone() {
    return this.status === 'done'
  }
}
