import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/lucid'

/**
 * Absolute paths (the Docker volume, /data/app.db) are used as-is, relative
 * ones resolve against the app root.
 */
const dbPath = resolve(fileURLToPath(app.appRoot), env.get('DB_PATH', 'tmp/db.sqlite3'))

const dbConfig = defineConfig({
  /**
   * Default connection used for all queries.
   */
  connection: 'sqlite',

  /**
   * Pretty-print SQL debug output in development logs.
   */
  prettyPrintDebugQueries: true,

  connections: {
    sqlite: {
      client: 'better-sqlite3',
      connection: {
        filename: dbPath,
      },
      useNullAsDefault: true,
      pool: {
        /**
         * WAL lets the nightly `.backup` and readers run alongside writes,
         * and busy_timeout makes a locked write wait instead of failing.
         */
        afterCreate: (conn: any, done: (error: Error | null, conn: any) => void) => {
          try {
            conn.pragma('journal_mode = WAL')
            conn.pragma('foreign_keys = ON')
            conn.pragma('busy_timeout = 5000')
            done(null, conn)
          } catch (error) {
            done(error as Error, conn)
          }
        },
      },
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
      schemaGeneration: {
        enabled: true,
        rulesPaths: ['./database/schema_rules.js'],
      },
      /**
       * Emit SQL queries to the logger in development.
       */
      debug: app.inDev,
    },
  },
})

export default dbConfig
