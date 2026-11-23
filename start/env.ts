/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

const env = await Env.create(new URL('../', import.meta.url), {
  // Node
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),

  // App
  APP_KEY: Env.schema.secret(),
  APP_URL: Env.schema.string({ format: 'url', tld: false }),

  // Session
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory', 'database'] as const),

  // Storage
  // SQLite file. Defaults to tmp/db.sqlite3 for local development.
  DB_PATH: Env.schema.string.optional(),
  // Checkout of the cp-trainer-content repo. Defaults to ../cp-trainer-content.
  CONTENT_DIR: Env.schema.string.optional(),
  // Also play draft problems (author preview). Defaults to false.
  CONTENT_INCLUDE_DRAFTS: Env.schema.boolean.optional(),
  // The content repo on GitHub, for "Report a problem" and the contribute page.
  CONTENT_REPO_URL: Env.schema.string.optional({ format: 'url', tld: true }),

  // Backups (node ace db:backup). Defaults to tmp/backups locally; /backups in Docker.
  BACKUP_DIR: Env.schema.string.optional(),

  // Time zone that cuts days in `node ace stats` (an IANA name). Defaults to UTC.
  // The stored timestamps stay in UTC either way (TZ above).
  APP_TIMEZONE: Env.schema.string.optional(),

  // Accounts (plan §12.9). The GitHub OAuth app; without it the "Continue
  // with GitHub" button is hidden. The callback is APP_URL/auth/github/callback.
  GITHUB_CLIENT_ID: Env.schema.string.optional(),
  GITHUB_CLIENT_SECRET: Env.schema.string.optional(),
  // Sign in as a made-up user without GitHub (local work and tests only).
  AUTH_DEV_LOGIN: Env.schema.boolean.optional(),
})

assertSafeAuth(env.get('NODE_ENV'), env.get('AUTH_DEV_LOGIN'))

export default env

/**
 * The dev login lets anyone sign in as anyone, so production refuses to
 * start with it on.
 */
export function assertSafeAuth(nodeEnv: string, devLogin: boolean | undefined) {
  if (nodeEnv === 'production' && devLogin) {
    throw new Error('AUTH_DEV_LOGIN must be off in production')
  }
}
