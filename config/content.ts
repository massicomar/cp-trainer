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

  /**
   * Also offer `draft` problems in sessions, so authors can play what they're
   * writing. Off in production: drafts may have no summary yet.
   */
  includeDrafts: env.get('CONTENT_INCLUDE_DRAFTS', false),

  /**
   * The content repo on GitHub: "Report a problem" opens issues there, and
   * the contribute page links to it.
   */
  repoUrl: env.get('CONTENT_REPO_URL', 'https://github.com/massicomar/cp-trainer-content'),
}

export default contentConfig

/**
 * Problem statuses that sessions may draw from.
 */
export function playableStatuses() {
  return contentConfig.includeDrafts ? ['ready', 'draft'] : ['ready']
}
