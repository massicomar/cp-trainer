import { UserSchema } from '#database/schema'
import Player from '#models/player'
import { hasOne } from '@adonisjs/lucid/orm'
import type { HasOne } from '@adonisjs/lucid/types/relations'

/**
 * Someone signed in with GitHub (or, locally, the dev login). Owns exactly
 * one player, and all play history hangs off that player (plan §12.9). Only
 * the GitHub username, name and avatar are kept.
 */
export default class User extends UserSchema {
  declare provider: 'github' | 'dev'

  @hasOne(() => Player)
  declare player: HasOne<typeof Player>
}
