import { randomUUID } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { DateTime } from 'luxon'
import Player from '#models/player'
import type User from '#models/user'

export const PLAYER_COOKIE = 'pid'

/**
 * Loads who is playing into `ctx.player` and the signed-in user (if any)
 * into `ctx.currentUser` and the views.
 *
 * - Signed in: the account's player, created here if it's missing.
 * - Anonymous: the player in the signed `pid` cookie, or null for a new
 *   browser. That row and cookie are only created when someone starts a
 *   round (`findOrCreatePlayer`), so crawlers and uptime pings don't fill
 *   the table. A cookie that points at an account's player is ignored: after
 *   signing out, that history belongs to the account, not the browser.
 */
export default class PlayerMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    ctx.player = null
    ctx.currentUser = (await ctx.auth.check()) ? (ctx.auth.user ?? null) : null

    if (ctx.currentUser) {
      ctx.player = await accountPlayer(ctx.currentUser)
    } else {
      const id = ctx.request.cookie(PLAYER_COOKIE)
      if (typeof id === 'string') {
        const player = await Player.find(id)
        if (player && !player.userId) ctx.player = player
      }
    }

    // Coarse on purpose: one write per hour at most.
    if (ctx.player && ctx.player.lastSeenAt.diffNow('hours').hours < -1) {
      ctx.player.lastSeenAt = DateTime.now()
      await ctx.player.save()
    }

    ctx.view.share({ currentUser: ctx.currentUser })
    return next()
  }
}

/**
 * The account's one player. Sign-in always creates or claims it, so this
 * only creates one if the row went missing.
 */
async function accountPlayer(user: User): Promise<Player> {
  const player = await Player.findBy('user_id', user.id)
  if (player) return player
  return Player.create({
    id: randomUUID(),
    userId: user.id,
    preferences: null,
    lastSeenAt: DateTime.now(),
  })
}

export async function findOrCreatePlayer(ctx: HttpContext): Promise<Player> {
  if (ctx.player) return ctx.player

  const player = await Player.create({
    id: randomUUID(),
    userId: null,
    preferences: null,
    lastSeenAt: DateTime.now(),
  })
  ctx.response.cookie(PLAYER_COOKIE, player.id, {
    maxAge: '365d',
    httpOnly: true,
    sameSite: 'lax',
  })
  ctx.player = player
  return player
}

declare module '@adonisjs/core/http' {
  export interface HttpContext {
    player: Player | null
    currentUser: User | null
  }
}
