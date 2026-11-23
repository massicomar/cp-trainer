import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import Player from '#models/player'
import User from '#models/user'

/** Who someone is at the provider: all an account keeps about them. */
export interface Identity {
  provider: 'github' | 'dev'
  providerId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
}

/** Play history, moved together when two players merge. */
const PLAYER_TABLES = ['lessons', 'attempts', 'drill_attempts'] as const

/**
 * Accounts and the anonymous history they take over (plan §12.9).
 */
export default class Accounts {
  /**
   * Finds or creates the user and refreshes their profile. Then the
   * browser's anonymous player, if any, joins the account:
   *
   * - first sign-in (the account has no player yet): it becomes the
   *   account's player, history and all (claim);
   * - later sign-ins: its lessons and answers move into the account's
   *   player, and the anonymous row is deleted (merge).
   *
   * All in one transaction.
   */
  async signIn(identity: Identity, anonymous: Player | null): Promise<User> {
    return db.transaction(async (trx) => {
      const now = DateTime.now()
      const profile = {
        username: identity.username,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        lastLoginAt: now,
      }

      let user = await User.query({ client: trx })
        .where('provider', identity.provider)
        .where('provider_id', identity.providerId)
        .first()
      if (user) {
        await user.merge(profile).useTransaction(trx).save()
      } else {
        user = await User.create(
          { provider: identity.provider, providerId: identity.providerId, ...profile },
          { client: trx }
        )
      }

      const own = await Player.query({ client: trx }).where('user_id', user.id).first()
      const stray = anonymous && !anonymous.userId ? anonymous : null

      if (!own && stray) {
        stray.userId = user.id
        await stray.useTransaction(trx).save()
      } else if (!own) {
        await Player.create(
          { id: randomUUID(), userId: user.id, preferences: null, lastSeenAt: now },
          { client: trx }
        )
      } else if (stray && stray.id !== own.id) {
        await this.merge(stray, own, trx)
      }
      return user
    })
  }

  /**
   * Deletes the user, its player and everything that player answered.
   */
  async deleteAccount(user: User) {
    await db.transaction(async (trx) => {
      const players = await trx.from('players').where('user_id', user.id).select('id')
      const ids = players.map((p) => p.id as string)
      if (ids.length) {
        // Answers first: they reference lessons.
        for (const table of [...PLAYER_TABLES].reverse()) {
          await trx.from(table).whereIn('player_id', ids).delete()
        }
        await trx.from('players').whereIn('id', ids).delete()
      }
      await trx.from('users').where('id', user.id).delete()
    })
  }

  /**
   * Moves an anonymous player's history into the account's player. The
   * account keeps its own last selection; it takes the anonymous one only
   * if it had none.
   */
  protected async merge(from: Player, into: Player, trx: TransactionClientContract) {
    for (const table of PLAYER_TABLES) {
      await trx.from(table).where('player_id', from.id).update({ player_id: into.id })
    }
    if (!into.preferences && from.preferences) {
      into.preferences = from.preferences
      await into.useTransaction(trx).save()
    }
    await trx.from('players').where('id', from.id).delete()
  }
}

/**
 * The public GitHub profile behind an OAuth token. The app asks for no
 * scopes, so this is all it can read.
 */
export async function githubIdentity(token: string): Promise<Identity> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'cp-trainer',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok) throw new Error(`GitHub profile request failed (${response.status})`)
  const body = (await response.json()) as {
    id: number
    login: string
    name: string | null
    avatar_url: string | null
  }
  return {
    provider: 'github',
    providerId: String(body.id),
    username: body.login,
    displayName: body.name,
    avatarUrl: body.avatar_url,
  }
}
