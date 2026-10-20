import db from '@adonisjs/lucid/services/db'
import type Layer from '#models/layer'
import Problem from '#models/problem'
import Subject from '#models/subject'
import Technique from '#models/technique'
import type { AnswerRef, SubjectInfo, TechniqueInfo } from '#types/play'

export interface Taxonomy {
  /** Visible subjects first (taxonomy order), hidden ones ("None of these") last. */
  subjects: SubjectInfo[]
  subjectById: Map<string, SubjectInfo>
  techniques: TechniqueInfo[]
  techniqueById: Map<string, TechniqueInfo>
}

/**
 * Everything needed to ask and grade one problem's questions.
 */
export interface ProblemBundle {
  problem: Problem
  /** Non-deprecated layers by position: subject, technique, then extraLayers. */
  layers: Layer[]
  answers: AnswerRef[]
}

/**
 * Read access to the synced content tables. Deprecated subjects, techniques
 * and layers are left out; deprecated problems are still loadable so lessons
 * that already include them can finish.
 */
export default class Catalog {
  async taxonomy(): Promise<Taxonomy> {
    const subjectRows = await Subject.query()
      .where('deprecated', false)
      .orderBy('hidden')
      .orderBy('position')
    const techniqueRows = await Technique.query().where('deprecated', false).orderBy('position')

    const subjects = subjectRows.map((s) => ({
      id: s.id,
      name: s.name,
      hidden: s.hidden,
      position: s.position,
    }))
    const techniques = techniqueRows.map((t) => ({
      id: t.id,
      subjectId: t.subjectId,
      name: t.name,
      confusableWith: t.confusableWith,
      position: t.position,
    }))
    return {
      subjects,
      subjectById: new Map(subjects.map((s) => [s.id, s])),
      techniques,
      techniqueById: new Map(techniques.map((t) => [t.id, t])),
    }
  }

  async bundles(problemIds: string[]): Promise<Map<string, ProblemBundle>> {
    const problems = await Problem.query()
      .whereIn('id', problemIds)
      .preload('layers', (query) => query.where('deprecated', false).orderBy('position'))
    const answerRows = await db
      .from('problem_answers')
      .whereIn('problem_id', problemIds)
      .select('problem_id', 'kind', 'answer_id', 'role')

    const bundles = new Map<string, ProblemBundle>()
    for (const problem of problems) {
      bundles.set(problem.id, {
        problem,
        layers: problem.layers,
        answers: answerRows
          .filter((row) => row.problem_id === problem.id)
          .map((row) => ({ kind: row.kind, id: row.answer_id, role: row.role })),
      })
    }
    return bundles
  }

  async bundle(problemId: string): Promise<ProblemBundle> {
    const bundles = await this.bundles([problemId])
    const bundle = bundles.get(problemId)
    if (!bundle) throw new Error(`problem ${problemId} is not in the database`)
    return bundle
  }
}
