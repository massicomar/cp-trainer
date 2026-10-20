import { I18n } from '@adonisjs/i18n'
import i18nManager from '@adonisjs/i18n/services/main'
import type { NextFn } from '@adonisjs/core/types/http'
import { type HttpContext, RequestValidator } from '@adonisjs/core/http'

export const LOCALE_COOKIE = 'locale'

/**
 * Picks the UI language: the `locale` cookie set by the header switch, else
 * the browser's Accept-Language, else English. Shares the request's i18n
 * object with the HTTP context and Edge (`t()` in templates).
 */
export default class DetectUserLocaleMiddleware {
  /**
   * Using i18n for validation messages. Applicable to only
   * "request.validateUsing" method calls
   */
  static {
    RequestValidator.messagesProvider = (ctx) => {
      return ctx.i18n.createMessagesProvider()
    }
  }

  protected getRequestLocale(ctx: HttpContext) {
    const chosen = ctx.request.plainCookie(LOCALE_COOKIE)
    if (typeof chosen === 'string' && i18nManager.supportedLocales().includes(chosen)) {
      return chosen
    }
    return i18nManager.getSupportedLocaleFor(ctx.request.languages())
  }

  async handle(ctx: HttpContext, next: NextFn) {
    ctx.i18n = i18nManager.locale(this.getRequestLocale(ctx) || i18nManager.defaultLocale)

    /**
     * Lets the container inject the request's I18n instance.
     */
    ctx.containerResolver.bindValue(I18n, ctx.i18n)

    if ('view' in ctx) {
      ctx.view.share({ i18n: ctx.i18n })
    }

    return next()
  }
}

/**
 * Notify TypeScript about i18n property
 */
declare module '@adonisjs/core/http' {
  export interface HttpContext {
    i18n: I18n
  }
}
