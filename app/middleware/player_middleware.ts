import { randomUUID } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { DateTime } from 'luxon'
import Player from '#models/player'

export const PLAYER_COOKIE = 'pid'

/**
 * Loads the anonymous player from the signed `pid` cookie into `ctx.player`
 * (null for a new browser). The player row and cookie are only created when
 * someone starts a lesson (`findOrCreatePlayer`), so crawlers and uptime pings
 * don't fill the table.
 */
export default class PlayerMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    ctx.player = null
    const id = ctx.request.cookie(PLAYER_COOKIE)
    if (typeof id === 'string') {
      const player = await Player.find(id)
      if (player) {
        // Coarse on purpose: one write per hour at most.
        if (player.lastSeenAt.diffNow('hours').hours < -1) {
          player.lastSeenAt = DateTime.now()
          await player.save()
        }
        ctx.player = player
      }
    }
    return next()
  }
}

export async function findOrCreatePlayer(ctx: HttpContext): Promise<Player> {
  if (ctx.player) return ctx.player

  const player = await Player.create({
    id: randomUUID(),
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
  }
}
