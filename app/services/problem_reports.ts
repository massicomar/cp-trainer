import contentConfig from '#config/content'

export type ReportTarget =
  | {
      type: 'problem'
      problemId: string
      /** The layer key (`subject`, `technique`, `dp-state`, …); null for the whole problem. */
      layer: string | null
    }
  | {
      type: 'drill'
      kind: string
      /** The file (and algorithm) it came from, e.g. "drills/graphs.json → dijkstra-heap". */
      source: string
      /** What was asked: n, complexity, options… */
      params: Record<string, unknown>
    }

/**
 * A "new issue" link on the content repo, pre-filled through the issue form
 * in `.github/ISSUE_TEMPLATE/problem-report.yml` (its field ids are `problem`
 * and `layer`; the reporter picks a category and writes the details). For a
 * drill, `problem` names its file and `layer` its kind and what was asked.
 */
export function problemReportUrl(target: ReportTarget, repoUrl = contentConfig.repoUrl) {
  const query = new URLSearchParams({ template: 'problem-report.yml' })
  if (target.type === 'problem') {
    const { problemId, layer } = target
    query.set('title', `Report: ${problemId}${layer ? ` (${layer})` : ''}`)
    query.set('problem', problemId)
    if (layer) query.set('layer', layer)
  } else {
    const asked = Object.entries(target.params)
      .map(([key, value]) => `${key} = ${Array.isArray(value) ? value.join(', ') : value}`)
      .join('; ')
    query.set('title', `Report: drill ${target.kind} (${asked})`)
    query.set('problem', target.source)
    query.set('layer', `drill ${target.kind}: ${asked}`)
  }
  return `${repoUrl}/issues/new?${query}`
}
