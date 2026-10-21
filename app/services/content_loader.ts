import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import type {
  BigOFile,
  ContentIssue,
  LoadedContent,
  LoadedDrills,
  LoadedProblem,
  ProblemFile,
  SubjectDrillsFile,
  TaxonomyFile,
} from '#types/content'

export type LoadResult =
  { ok: true; content: LoadedContent } | { ok: false; errors: ContentIssue[] }

/**
 * What a single draft is checked against: the synced taxonomy and problems.
 */
export interface DraftWorld {
  subjectIds: Set<string>
  techniqueSubject: Map<string, string>
  problemIds: Set<string>
}

/**
 * Layers 1 and 2 get these keys, so an extraLayer can't use them.
 */
export const GENERATED_LAYER_KEYS = ['subject', 'technique'] as const

/**
 * Reads the content repo and checks it before anything reaches the database.
 *
 * Validation uses the repo's own JSON Schemas (schema/*.schema.json), plus the
 * cross-file checks the app depends on: one intended answer, every id
 * referenced exists, extra layers are well formed, drills are consistent. Authoring rules that don't
 * affect the app (URL allowlist, leak lint, no deletions) stay in the content
 * repo's CI.
 */
export default class ContentLoader {
  async load(root: string): Promise<LoadResult> {
    const errors: ContentIssue[] = []
    const err = (file: string, message: string) => errors.push({ file, message })

    let validateProblem: ValidateFunction
    let validateTaxonomy: ValidateFunction
    try {
      const ajv = new Ajv2020({ allErrors: true, strict: true })
      addFormats.default(ajv)
      validateProblem = ajv.compile(await readJson(join(root, 'schema/problem.schema.json')))
      validateTaxonomy = ajv.compile(await readJson(join(root, 'schema/taxonomy.schema.json')))
    } catch (error) {
      err('schema/', `cannot load the JSON Schemas: ${messageOf(error)}`)
      return { ok: false, errors }
    }

    /**
     * Taxonomy. Problems are checked against it, so stop here if it's broken.
     */
    let taxonomy: TaxonomyFile
    try {
      taxonomy = await readJson<TaxonomyFile>(join(root, 'taxonomy.json'))
    } catch (error) {
      err('taxonomy.json', messageOf(error))
      return { ok: false, errors }
    }
    if (!validateTaxonomy(taxonomy)) {
      for (const e of validateTaxonomy.errors ?? []) err('taxonomy.json', schemaMessage(e))
      return { ok: false, errors }
    }

    const subjectIds = new Set<string>()
    const techniqueSubject = new Map<string, string>()
    for (const subject of taxonomy.subjects) {
      if (subjectIds.has(subject.id)) err('taxonomy.json', `duplicate subject ${subject.id}`)
      subjectIds.add(subject.id)
      for (const technique of subject.techniques) {
        if (techniqueSubject.has(technique.id)) {
          err('taxonomy.json', `duplicate technique ${technique.id}`)
        }
        if (!technique.id.startsWith(`${subject.id}.`)) {
          err('taxonomy.json', `technique ${technique.id} must start with "${subject.id}."`)
        }
        techniqueSubject.set(technique.id, subject.id)
      }
    }
    for (const subject of taxonomy.subjects) {
      for (const technique of subject.techniques) {
        for (const other of technique.confusableWith ?? []) {
          if (!techniqueSubject.has(other)) {
            err('taxonomy.json', `${technique.id}.confusableWith: unknown technique ${other}`)
          }
        }
      }
    }

    /**
     * Problems.
     */
    let paths: string[]
    try {
      paths = await listJsonFiles(join(root, 'problems'))
    } catch (error) {
      err('problems/', messageOf(error))
      return { ok: false, errors }
    }

    const problems = new Map<string, LoadedProblem>()
    for (const path of paths) {
      const file = relative(root, path).split(sep).join('/')
      const bytes = await readFile(path)

      let problem: ProblemFile
      try {
        problem = JSON.parse(bytes.toString('utf8'))
      } catch (error) {
        err(file, `invalid JSON: ${messageOf(error)}`)
        continue
      }
      if (!validateProblem(problem)) {
        for (const e of validateProblem.errors ?? []) err(file, schemaMessage(e))
        continue
      }

      const existing = problems.get(problem.id)
      if (existing) {
        err(file, `duplicate id ${problem.id} (also in ${existing.file})`)
        continue
      }
      problems.set(problem.id, {
        problem,
        file,
        hash: createHash('sha256').update(bytes).digest('hex'),
      })

      this.checkAnswers(problem, file, subjectIds, techniqueSubject, err)
      this.checkExtraLayers(problem, file, err)
      this.checkSpanish(problem, file, err)
    }

    for (const { problem, file } of problems.values()) {
      for (const id of problem.pairWith ?? []) {
        if (id === problem.id) err(file, 'pairWith references itself')
        else if (!problems.has(id)) err(file, `pairWith: unknown problem ${id}`)
      }
    }

    const drills = await this.loadDrills(root, taxonomy, err)

    if (errors.length) return { ok: false, errors }
    return { ok: true, content: { taxonomy, problems: [...problems.values()], drills } }
  }

  /**
   * drills/big-o.json (the table generated drills use) and drills/<subject>.json
   * (algorithms with their complexity). The folder is optional.
   */
  protected async loadDrills(
    root: string,
    taxonomy: TaxonomyFile,
    err: (file: string, message: string) => void
  ): Promise<LoadedDrills> {
    const drills: LoadedDrills = { bigO: null, subjects: [] }
    let entries: string[]
    try {
      entries = await readdir(join(root, 'drills'))
    } catch {
      return drills
    }
    const names = entries.filter((n) => n.endsWith('.json')).sort()
    if (!names.length) return drills

    let validateBigO: ValidateFunction
    let validateSubject: ValidateFunction
    try {
      const ajv = new Ajv2020({ allErrors: true, strict: true })
      addFormats.default(ajv)
      validateBigO = ajv.compile(await readJson(join(root, 'schema/big-o.schema.json')))
      validateSubject = ajv.compile(await readJson(join(root, 'schema/subject-drills.schema.json')))
    } catch (error) {
      err('schema/', `cannot load the drill JSON Schemas: ${messageOf(error)}`)
      return drills
    }

    for (const name of names) {
      const file = `drills/${name}`
      let data: unknown
      try {
        data = await readJson(join(root, file))
      } catch (error) {
        err(file, `invalid JSON: ${messageOf(error)}`)
        continue
      }

      if (name === 'big-o.json') {
        if (!validateBigO(data)) {
          for (const e of validateBigO.errors ?? []) err(file, schemaMessage(e))
          continue
        }
        const table = data as BigOFile
        const ids = table.complexities.map((c) => c.id)
        if (new Set(ids).size !== ids.length) err(file, 'duplicate complexity id')
        table.complexities.forEach((c, i) => {
          const previous = table.complexities[i - 1]
          if (previous && c.maxN > previous.maxN) {
            err(file, `${c.id}: maxN is larger than ${previous.id}'s, which grows slower`)
          }
        })
        drills.bigO = table
        continue
      }

      if (!validateSubject(data)) {
        for (const e of validateSubject.errors ?? []) err(file, schemaMessage(e))
        continue
      }
      const subjectDrills = data as SubjectDrillsFile
      const subject = taxonomy.subjects.find((s) => s.id === subjectDrills.subject)
      if (name !== `${subjectDrills.subject}.json`) {
        err(file, `file name must be ${subjectDrills.subject}.json`)
      }
      if (!subject) err(file, `unknown subject ${subjectDrills.subject}`)
      else if (subject.hidden)
        err(file, `subject ${subject.id} is hidden; its drills can't be asked`)
      const seen = new Set<string>()
      for (const algorithm of subjectDrills.algorithms) {
        if (seen.has(algorithm.id)) err(file, `duplicate algorithm id ${algorithm.id}`)
        seen.add(algorithm.id)
        const plain = (latex: string) => latex.replace(/\s+/g, '')
        if (algorithm.wrong.some((w) => plain(w) === plain(algorithm.complexity))) {
          err(file, `${algorithm.id}: a wrong option equals the right complexity`)
        }
        if (new Set(algorithm.wrong.map(plain)).size !== algorithm.wrong.length) {
          err(file, `${algorithm.id}: two wrong options are the same`)
        }
      }
      drills.subjects.push({ file, drills: subjectDrills })
    }
    return drills
  }

  /**
   * Checks a single problem that isn't on disk (the contribute page), with
   * the same schema and cross-reference rules `load` applies, against the
   * synced taxonomy and problem ids.
   */
  async checkDraft(root: string, problem: unknown, world: DraftWorld): Promise<string[]> {
    const messages: string[] = []
    const err = (_file: string, message: string) => messages.push(message)

    let validateProblem: ValidateFunction
    try {
      const ajv = new Ajv2020({ allErrors: true, strict: true })
      addFormats.default(ajv)
      validateProblem = ajv.compile(await readJson(join(root, 'schema/problem.schema.json')))
    } catch (error) {
      return [`cannot load the JSON Schema: ${messageOf(error)}`]
    }
    if (!validateProblem(problem)) {
      return (validateProblem.errors ?? []).map(schemaMessage)
    }

    const file = problem as ProblemFile
    this.checkAnswers(file, '', world.subjectIds, world.techniqueSubject, err)
    this.checkExtraLayers(file, '', err)
    this.checkSpanish(file, '', err)
    for (const id of file.pairWith ?? []) {
      if (id === file.id) err('', 'pairWith references itself')
      else if (!world.problemIds.has(id)) err('', `pairWith: unknown problem ${id}`)
    }
    return messages
  }

  protected checkAnswers(
    problem: ProblemFile,
    file: string,
    subjectIds: Set<string>,
    techniqueSubject: Map<string, string>,
    err: (file: string, message: string) => void
  ) {
    const { subjects, techniques } = problem.answers
    const intendedSubjects = subjects.filter((s) => s.role === 'intended')
    const intendedTechniques = techniques.filter((t) => t.role === 'intended')
    if (intendedSubjects.length !== 1) err(file, 'answers.subjects needs exactly one "intended"')
    if (intendedTechniques.length !== 1) {
      err(file, 'answers.techniques needs exactly one "intended"')
    }
    if (new Set(subjects.map((s) => s.id)).size !== subjects.length) {
      err(file, 'answers.subjects lists a subject twice')
    }
    if (new Set(techniques.map((t) => t.id)).size !== techniques.length) {
      err(file, 'answers.techniques lists a technique twice')
    }

    const listedSubjects = new Set(subjects.map((s) => s.id))
    for (const subject of subjects) {
      if (!subjectIds.has(subject.id)) err(file, `answers.subjects: unknown subject ${subject.id}`)
    }
    for (const technique of techniques) {
      const owner = techniqueSubject.get(technique.id)
      if (!owner) {
        err(file, `answers.techniques: unknown technique ${technique.id}`)
      } else if (!listedSubjects.has(owner)) {
        err(file, `technique ${technique.id} belongs to ${owner}, which isn't in answers.subjects`)
      }
    }

    const intendedSubject = intendedSubjects[0]?.id
    const intendedTechnique = intendedTechniques[0]?.id
    if (
      intendedSubject &&
      intendedTechnique &&
      techniqueSubject.get(intendedTechnique) !== intendedSubject
    ) {
      err(file, `the intended technique must belong to the intended subject (${intendedSubject})`)
    }

    for (const id of problem.appearsIn ?? []) {
      if (!subjectIds.has(id)) err(file, `appearsIn: unknown subject ${id}`)
    }
    for (const id of problem.distractors ?? []) {
      if (!techniqueSubject.has(id)) err(file, `distractors: unknown technique ${id}`)
      if (techniques.some((t) => t.id === id))
        err(file, `distractor ${id} is also a correct answer`)
    }
  }

  protected checkExtraLayers(
    problem: ProblemFile,
    file: string,
    err: (file: string, message: string) => void
  ) {
    const keys = new Set<string>()
    for (const layer of problem.extraLayers ?? []) {
      if (keys.has(layer.key)) err(file, `duplicate layer key ${layer.key}`)
      keys.add(layer.key)
      if ((GENERATED_LAYER_KEYS as readonly string[]).includes(layer.key)) {
        err(file, `layer key "${layer.key}" is reserved for the generated layer`)
      }

      const optionIds = layer.options.map((o) => o.id)
      if (new Set(optionIds).size !== optionIds.length) {
        err(file, `layer ${layer.key}: duplicate option ids`)
      }
      for (const id of layer.accepted) {
        if (!optionIds.includes(id))
          err(file, `layer ${layer.key}: accepted "${id}" is not an option`)
      }
      if (layer.accepted.length >= layer.options.length) {
        err(file, `layer ${layer.key}: every option is accepted`)
      }
    }
  }

  /**
   * The `es` block can only translate what exists in English.
   */
  protected checkSpanish(
    problem: ProblemFile,
    file: string,
    err: (file: string, message: string) => void
  ) {
    if (!problem.es) return
    const traps = problem.traps ?? []
    if (problem.es.traps && problem.es.traps.length !== traps.length) {
      err(file, `es.traps has ${problem.es.traps.length} entries, traps has ${traps.length}`)
    }
    for (const [key, layer] of Object.entries(problem.es.layers ?? {})) {
      const english = problem.extraLayers?.find((l) => l.key === key)
      if (!english) {
        err(file, `es.layers: no extra layer with key ${key}`)
        continue
      }
      for (const id of Object.keys(layer.why ?? {})) {
        if (!english.options.some((o) => o.id === id)) {
          err(file, `es.layers.${key}.why: no option ${id}`)
        }
      }
    }
  }
}

async function readJson<T = unknown>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function listJsonFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()
}

function schemaMessage(error: ErrorObject) {
  const where = error.instancePath || '/'
  const extra = error.params?.additionalProperty ? ` ("${error.params.additionalProperty}")` : ''
  return `schema ${where} ${error.message}${extra}`
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
