import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

export const THEME_COOKIE = 'theme'
export const THEMES = ['system', 'light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

/**
 * Shares the chosen theme with every view, so the layout renders
 * `<html data-theme>` on the server and the page never flashes the wrong
 * colors. "system" (the default) follows the OS.
 */
export default class ThemeMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const chosen = ctx.request.plainCookie(THEME_COOKIE)
    const theme: Theme = THEMES.includes(chosen) ? chosen : 'system'
    ctx.view.share({ theme })
    return next()
  }
}
