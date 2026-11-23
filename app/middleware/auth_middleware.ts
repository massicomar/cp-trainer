import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * For the account-only routes (Custom, the account page): anyone not signed
 * in is sent to the login page.
 */
export default class AuthMiddleware {
  redirectTo = '/entrar'

  async handle(ctx: HttpContext, next: NextFn) {
    await ctx.auth.authenticateUsing(['web'], { loginRoute: this.redirectTo })
    return next()
  }
}
