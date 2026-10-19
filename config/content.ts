import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import env from '#start/env'
import app from '@adonisjs/core/services/app'

const contentConfig = {
  /**
   * Checkout of the cp-trainer-content repo: /content in Docker, the sibling
   * folder ../cp-trainer-content when running locally.
   */
  dir: resolve(fileURLToPath(app.appRoot), env.get('CONTENT_DIR', '../cp-trainer-content')),
}

export default contentConfig
