import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import Database from 'better-sqlite3'

export interface BackupResult {
  file: string
  bytes: number
  /** Older backups deleted by the retention rule. */
  pruned: string[]
}

/** app-2026-10-21T031500Z.db */
const NAME = /^app-(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})Z\.db$/

/**
 * Copies the live SQLite database with SQLite's online backup API, which is
 * safe while the app keeps writing (WAL included), then checks the copy and
 * deletes copies older than `keepDays`. Player history is the only data that
 * isn't in git; content can always be re-synced.
 */
export async function backupDatabase(options: {
  dbPath: string
  dir: string
  keepDays: number
  now?: Date
}): Promise<BackupResult> {
  const now = options.now ?? new Date()
  await mkdir(options.dir, { recursive: true })

  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')
  const name = `app-${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6)}.db`
  const file = join(options.dir, name)

  const source = new Database(options.dbPath, { readonly: true, fileMustExist: true })
  try {
    await source.backup(file)
  } finally {
    source.close()
  }

  // The copy inherits WAL mode; switch it back so each backup is one
  // self-contained file (no -wal / -shm next to it), then check it.
  const copy = new Database(file)
  try {
    copy.pragma('journal_mode = DELETE')
    const result = copy.pragma('integrity_check', { simple: true })
    if (result !== 'ok') throw new Error(`integrity check of ${file} failed: ${result}`)
  } finally {
    copy.close()
  }

  const pruned = await prune(options.dir, name, options.keepDays, now)
  const { size } = await stat(file)
  return { file, bytes: size, pruned }
}

/**
 * Deletes backups (by the date in their name) older than `keepDays`. Never
 * deletes the one just written, and leaves files it didn't name alone.
 */
async function prune(dir: string, keep: string, keepDays: number, now: Date) {
  const cutoff = now.getTime() - keepDays * 24 * 60 * 60 * 1000
  const pruned: string[] = []
  for (const entry of await readdir(dir)) {
    const match = entry.match(NAME)
    if (!match || entry === keep) continue
    const [, day, hh, mm, ss] = match
    const taken = Date.parse(`${day}T${hh}:${mm}:${ss}Z`)
    if (taken < cutoff) {
      await rm(join(dir, entry))
      pruned.push(entry)
    }
  }
  return pruned.sort()
}
