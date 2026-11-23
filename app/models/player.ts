import { PlayerSchema } from '#database/schema'
import { jsonColumn } from '#database/column_types'
import Lesson from '#models/lesson'
import type { Selection } from '#types/play'
import { column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'

/**
 * Who plays. Without an account: one browser, identified by the signed `pid`
 * cookie, created on the first lesson, not on the first page view. With an
 * account: the user's one player (`userId`), whatever the browser.
 */
export default class Player extends PlayerSchema {
  static selfAssignPrimaryKey = true

  /** The last session selection, used to pre-fill the setup page. */
  @column(jsonColumn)
  declare preferences: Selection | null

  @hasMany(() => Lesson)
  declare lessons: HasMany<typeof Lesson>
}
