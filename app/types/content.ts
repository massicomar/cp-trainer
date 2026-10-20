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
}

export interface ContentIssue {
  file: string
  message: string
}
