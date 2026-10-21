import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@japa/runner'
import Database from 'better-sqlite3'
import { backupDatabase } from '#services/database_backup'

test.group('backupDatabase', (group) => {
  let dir: string
  let dbPath: string

  group.each.setup(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cp-trainer-backup-'))
    dbPath = join(dir, 'live.db')
    const live = new Database(dbPath)
    live.pragma('journal_mode = WAL')
    live.exec(
      "create table players (id text primary key); insert into players values ('p1'), ('p2')"
    )
    live.close()
    return () => rm(dir, { recursive: true, force: true })
  })

  test('writes a dated, readable copy of the database', async ({ assert }) => {
    const now = new Date('2026-10-21T03:15:00Z')

    const result = await backupDatabase({ dbPath, dir: join(dir, 'backups'), keepDays: 14, now })

    assert.match(result.file, /app-2026-10-21T031500Z\.db$/)
    assert.isAbove(result.bytes, 0)
    const copy = new Database(result.file, { readonly: true })
    assert.deepEqual(copy.prepare('select id from players order by id').pluck().all(), ['p1', 'p2'])
    copy.close()
  })

  test('works while the app has the database open and is writing', async ({ assert }) => {
    const app = new Database(dbPath)
    app.pragma('journal_mode = WAL')
    app.exec("insert into players values ('p3')")

    const result = await backupDatabase({ dbPath, dir: join(dir, 'backups'), keepDays: 14 })
    app.close()

    const copy = new Database(result.file, { readonly: true })
    assert.equal(copy.prepare('select count(*) from players').pluck().get(), 3)
    copy.close()
  })

  test('deletes backups older than the retention, and nothing else', async ({ assert }) => {
    const backups = join(dir, 'backups')
    await backupDatabase({
      dbPath,
      dir: backups,
      keepDays: 14,
      now: new Date('2026-10-01T03:00:00Z'),
    })
    await backupDatabase({
      dbPath,
      dir: backups,
      keepDays: 14,
      now: new Date('2026-10-10T03:00:00Z'),
    })
    await writeFile(join(backups, 'notes.txt'), 'not a backup')

    const result = await backupDatabase({
      dbPath,
      dir: backups,
      keepDays: 14,
      now: new Date('2026-10-21T03:00:00Z'),
    })

    assert.deepEqual(result.pruned, ['app-2026-10-01T030000Z.db'])
    assert.sameMembers(await readdir(backups), [
      'app-2026-10-10T030000Z.db',
      'app-2026-10-21T030000Z.db',
      'notes.txt',
    ])
  })

  test('fails when there is no database', async ({ assert }) => {
    await assert.rejects(() =>
      backupDatabase({ dbPath: join(dir, 'missing.db'), dir: join(dir, 'backups'), keepDays: 14 })
    )
  })
})
