import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A small content repo (tests/fixtures/content) with the real JSON Schemas.
 * Refresh the schemas with `npm run fixtures:schema` when the content repo
 * changes them.
 */
export const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/content', import.meta.url))

/**
 * A throwaway copy of the fixture repo that a test can edit freely.
 */
export class ContentFixture {
  private constructor(readonly dir: string) {}

  static async create() {
    const dir = await mkdtemp(join(tmpdir(), 'cp-trainer-content-'))
    await cp(FIXTURE_DIR, dir, { recursive: true })
    return new ContentFixture(dir)
  }

  async read(file: string) {
    return readFile(join(this.dir, file), 'utf8')
  }

  async readJson(file: string) {
    return JSON.parse(await this.read(file))
  }

  async writeJson(file: string, data: unknown) {
    await this.write(file, JSON.stringify(data, null, 2))
  }

  async editJson(file: string, edit: (data: any) => void) {
    const data = await this.readJson(file)
    edit(data)
    await this.writeJson(file, data)
  }

  async write(file: string, text: string) {
    await writeFile(join(this.dir, file), text)
  }

  async remove(file: string) {
    await rm(join(this.dir, file))
  }

  async cleanup() {
    await rm(this.dir, { recursive: true, force: true })
  }
}
