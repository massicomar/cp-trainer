import type { ProblemFile } from '#types/content'

/**
 * The contribute form's fields for a problem, as the page renders them:
 * nested objects for the body parser, checkboxes as "on" or absent.
 */
export function formFields(problem: ProblemFile): Record<string, any> {
  const on = (value: boolean | undefined) => (value ? 'on' : undefined)
  return {
    id: problem.id,
    status: problem.status,
    author: problem.author,
    collection: problem.collection,
    title: problem.title,
    source: problem.source,
    url: problem.url,
    difficulty: problem.difficulty,
    summary: problem.summary,
    constraints: { text: problem.constraints.text, verified: on(problem.constraints.verified) },
    subjects: problem.answers.subjects,
    techniques: problem.answers.techniques,
    appearsIn: problem.appearsIn ?? [],
    distractors: problem.distractors ?? [],
    explanation: problem.explanation,
    explanationEs: problem.es?.explanation ?? '',
    traps: (problem.traps ?? []).map((trap, i) => ({ en: trap, es: problem.es?.traps?.[i] ?? '' })),
    pairWith: problem.pairWith ?? [],
    layers: (problem.extraLayers ?? []).map((layer) => {
      const es = problem.es?.layers?.[layer.key]
      return {
        key: layer.key,
        kind: layer.kind,
        prompt: layer.prompt,
        explanation: layer.explanation,
        explanationEs: es?.explanation ?? '',
        options: layer.options.map((option) => ({
          text: option.text,
          why: option.why ?? '',
          whyEs: es?.why?.[option.id] ?? '',
          correct: on(layer.accepted.includes(option.id)),
        })),
      }
    }),
    notes: problem.notes ?? '',
    deprecated: on(problem.deprecated),
  }
}

/**
 * The same fields flattened to the bracket names a browser posts
 * (`subjects[0][id]`, `distractors[]`, …).
 */
export function flattenFields(value: unknown, prefix = ''): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  if (value === undefined || value === null) return out
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string')) {
      out[`${prefix}[]`] = value as string[]
    } else {
      value.forEach((item, i) => Object.assign(out, flattenFields(item, `${prefix}[${i}]`)))
    }
  } else if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      Object.assign(out, flattenFields(item, prefix ? `${prefix}[${key}]` : key))
    }
  } else {
    out[prefix] = String(value)
  }
  return out
}
