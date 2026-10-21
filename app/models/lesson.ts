import { LessonSchema } from '#database/schema'
import { booleanColumn, jsonColumn } from '#database/column_types'
import Attempt from '#models/attempt'
import Player from '#models/player'
import type { Tier } from '#types/content'
import type { LessonItem } from '#types/drills'
import type { Selection } from '#types/play'
import { belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

/**
 * Up to 5 problems drawn from a selection, with drills between them unless
 * the player turned them off. `items` is the order they're played in;
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

  @belongsTo(() => Player)
  declare player: BelongsTo<typeof Player>

  @hasMany(() => Attempt)
  declare attempts: HasMany<typeof Attempt>

  get selection(): Selection {
    return {
      subjects: this.subjectIds,
      tiers: this.tiers,
      includeCommunity: this.includeCommunity,
      includeDrills: this.includeDrills,
    }
  }

  get isDone() {
    return this.status === 'done'
  }
}
