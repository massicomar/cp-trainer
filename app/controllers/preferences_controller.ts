import type { HttpContext } from '@adonisjs/core/http'
import i18nManager from '@adonisjs/i18n/services/main'
import { LOCALE_COOKIE } from '#middleware/detect_user_locale_middleware'
import { THEME_COOKIE, THEMES } from '#middleware/theme_middleware'

const COOKIE = { maxAge: '365d', httpOnly: true, sameSite: 'lax' } as const

/**
 * The header switches (theme, language). Stored in plain cookies rather than
 * on the player, so they work before anyone has started a lesson.
 */
export default class PreferencesController {
  async update({ request, response }: HttpContext) {
    const theme = request.input('theme')
    if (THEMES.includes(theme)) response.plainCookie(THEME_COOKIE, theme, COOKIE)

    const locale = request.input('locale')
    if (i18nManager.supportedLocales().includes(locale)) {
      response.plainCookie(LOCALE_COOKIE, locale, COOKIE)
    }

    return response.redirect().back()
  }
}
