import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'
import { PLAYER_COOKIE } from '#middleware/player_middleware'
import Accounts, { githubIdentity, type Identity } from '#services/accounts'

/**
 * Signing in and out (plan §12.9). GitHub is the only real provider; the
 * dev login (AUTH_DEV_LOGIN, never in production) signs in as a made-up
 * user, for local work and the tests.
 */
@inject()
export default class AuthController {
  constructor(protected accounts: Accounts) {}

  /**
   * GET /entrar
   */
  async show({ view, response, currentUser, player }: HttpContext) {
    if (currentUser) return response.redirect('/')
    return view.render('pages/login', {
      github: githubConfigured(),
      devLogin: Boolean(env.get('AUTH_DEV_LOGIN')),
      hasHistory: player !== null,
    })
  }

  /**
   * GET /auth/github → GitHub's consent page.
   */
  async github({ ally, response, session, i18n }: HttpContext) {
    if (!githubConfigured()) {
      session.flash('error', i18n.t('messages.auth.errors.notConfigured'))
      return response.redirect('/entrar')
    }
    return ally.use('github').redirect()
  }

  /**
   * GET /auth/github/callback
   */
  async callback(ctx: HttpContext) {
    const { ally, response, session, i18n, logger } = ctx
    const github = ally.use('github')
    const fail = (key: 'cancelled' | 'failed') => {
      session.flash('error', i18n.t(`messages.auth.errors.${key}`))
      return response.redirect('/entrar')
    }
    if (github.accessDenied()) return fail('cancelled')
    if (github.stateMisMatch() || github.hasError()) return fail('failed')

    let identity: Identity
    try {
      const token = await github.accessToken()
      identity = await githubIdentity(token.token)
    } catch (error) {
      logger.warn({ err: error }, 'GitHub sign-in failed')
      return fail('failed')
    }
    return this.signIn(ctx, identity)
  }

  /**
   * POST /auth/dev { username }: only with AUTH_DEV_LOGIN.
   */
  async dev(ctx: HttpContext) {
    if (!env.get('AUTH_DEV_LOGIN')) return ctx.response.notFound()
    const raw = String(ctx.request.input('username') ?? '')
    const username =
      raw
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .slice(0, 39) || 'dev'
    return this.signIn(ctx, {
      provider: 'dev',
      providerId: username,
      username,
      displayName: null,
      avatarUrl: null,
    })
  }

  /**
   * POST /logout. The browser goes back to being anonymous, with no player:
   * the history stays with the account.
   */
  async logout({ auth, response }: HttpContext) {
    await auth.use('web').logout()
    response.clearCookie(PLAYER_COOKIE)
    return response.redirect('/')
  }

  /**
   * Signs in, bringing along this browser's anonymous rounds, then forgets
   * the browser's `pid` cookie: from now on the account says who plays.
   */
  protected async signIn(ctx: HttpContext, identity: Identity) {
    const user = await this.accounts.signIn(identity, ctx.player)
    await ctx.auth.use('web').login(user)
    ctx.response.clearCookie(PLAYER_COOKIE)
    return ctx.response.redirect('/')
  }
}

function githubConfigured() {
  return Boolean(env.get('GITHUB_CLIENT_ID') && env.get('GITHUB_CLIENT_SECRET'))
}
