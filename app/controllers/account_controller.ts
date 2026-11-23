import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { PLAYER_COOKIE } from '#middleware/player_middleware'
import Lesson from '#models/lesson'
import Accounts from '#services/accounts'

/**
 * The account page: who you are, signing out, and deleting the account.
 * Behind the auth middleware.
 */
@inject()
export default class AccountController {
  constructor(protected accounts: Accounts) {}

  /**
   * GET /cuenta
   */
  async show({ view, currentUser, player }: HttpContext) {
    const [row] = await Lesson.query()
      .where('player_id', player!.id)
      .where('status', 'done')
      .count('* as total')
    return view.render('pages/account', {
      user: currentUser!,
      rounds: Number(row.$extras.total),
    })
  }

  /**
   * POST /cuenta/borrar { confirm }: deletes the user, its player and every
   * answer, then signs out. The box has to be ticked.
   */
  async destroy({ auth, request, response, session, i18n, currentUser }: HttpContext) {
    if (request.input('confirm') !== 'yes') {
      session.flash('error', i18n.t('messages.account.delete.confirmFirst'))
      return response.redirect('/cuenta')
    }
    await this.accounts.deleteAccount(currentUser!)
    await auth.use('web').logout()
    response.clearCookie(PLAYER_COOKIE)
    session.flash('notice', i18n.t('messages.account.delete.done'))
    return response.redirect('/')
  }
}
