import db from '@adonisjs/lucid/services/db'
import type { HttpContext } from '@adonisjs/core/http'

export default class HealthController {
  /**
   * Used by the Docker healthcheck, the deploy workflow and the uptime pinger.
   * Fails when SQLite can't answer a trivial query.
   */
  async show({ response, logger }: HttpContext) {
    try {
      await db.rawQuery('select 1')
    } catch (error) {
      logger.error({ err: error }, 'health check: database unreachable')
      return response.serviceUnavailable({ status: 'error', database: 'unreachable' })
    }

    return { status: 'ok' }
  }
}
