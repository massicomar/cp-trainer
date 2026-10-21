/**
 * Shapes of the files in the cp-trainer-content repo. The JSON Schemas in that
 * repo (schema/*.schema.json) are the source of truth; these types mirror them.
 */

export type AnswerRole = 'intended' | 'accepted' | 'overkill'
export type Tier = 'easy' | 'medium' | 'hard'
export type ProblemStatus = 'draft' | 'ready'
export type Collection = 'official' | 'community'

export interface RoleRef {
  id: string
  role: AnswerRole
}

export interface LayerOption {
  id: string
  text: string
  why?: string
}

/** An option as the app stores it: with its Spanish `why` from the `es` block. */
export interface StoredLayerOption extends LayerOption {
  whyEs?: string
}

export interface ExtraLayerFile {
  key: string
  kind: string
  prompt: string
  options: LayerOption[]
  accepted: string[]
  explanation: string
}

export interface ProblemFile {
  schemaVersion: 1
  id: string
  status: ProblemStatus
  /** GitHub username of whoever added the problem. */
  author: string
  collection: Collection
  title: string
  source: string
  url: string
  difficulty: { tier: Tier; scale: string; value: string }
  summary: string
  constraints: { text: string; verified: boolean }
  answers: { subjects: RoleRef[]; techniques: RoleRef[] }
  appearsIn?: string[]
  distractors?: string[]
  explanation: string
  traps?: string[]
  pairWith?: string[]
  extraLayers?: ExtraLayerFile[]
  notes?: string
  deprecated: boolean
  /** Spanish versions of the texts that explain; anything missing falls back to English. */
  es?: ProblemSpanish
}

export interface ProblemSpanish {
  explanation?: string
  /** Same order as `traps`; an empty string falls back to the English entry. */
  traps?: string[]
  /** Keyed by extra layer key; `why` keyed by option id. */
  layers?: Record<string, { explanation?: string; why?: Record<string, string> }>
}

export interface TaxonomyFile {
  schemaVersion: 1
  subjects: {
    id: string
    name: string
    hidden?: boolean
    techniques: { id: string; name: string; confusableWith?: string[] }[]
  }[]
}

/** Growth functions the drills know how to evaluate (drills/big-o.json). */
export const COMPLEXITY_IDS = [
  '1',
  'log-n',
  'n',
  'n-log-n',
  'n2',
  'n2-log-n',
  'n3',
  '2n',
  'n-2n',
  'n-fact',
] as const
export type ComplexityId = (typeof COMPLEXITY_IDS)[number]

export interface Complexity {
  id: ComplexityId
  /** LaTeX without $ delimiters, e.g. O(n \log n). */
  label: string
  /** The largest n that fits in one second; 1e18 means any n. */
  maxN: number
}

/** drills/big-o.json */
export interface BigOFile {
  schemaVersion: 1
  opsPerSecond: number
  /** In order of growth, slowest first. */
  complexities: Complexity[]
  nValues: number[]
}

export interface AlgorithmDrillFile {
  id: string
  name: string
  /** LaTeX without $ delimiters. */
  complexity: string
  wrong: string[]
  explanation: string
  es?: { explanation?: string }
}

/** drills/<subject>.json */
export interface SubjectDrillsFile {
  schemaVersion: 1
  subject: string
  algorithms: AlgorithmDrillFile[]
}

export interface LoadedDrills {
  /** Null when the repo has no drills/big-o.json. */
  bigO: BigOFile | null
  subjects: { file: string; drills: SubjectDrillsFile }[]
}

export interface LoadedProblem {
  problem: ProblemFile
  /** Path relative to the content root, e.g. problems/dp/cses-1158.json */
  file: string
  /** sha256 of the file bytes */
  hash: string
}

export interface LoadedContent {
  taxonomy: TaxonomyFile
  problems: LoadedProblem[]
  drills: LoadedDrills
}

export interface ContentIssue {
  file: string
  message: string
}
