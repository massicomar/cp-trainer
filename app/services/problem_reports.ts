import contentConfig from '#config/content'

export interface ReportTarget {
  problemId: string
  /** The layer key (`subject`, `technique`, `dp-state`, …); null for the whole problem. */
  layer: string | null
}

/**
 * A "new issue" link on the content repo, pre-filled through the issue form
 * in `.github/ISSUE_TEMPLATE/problem-report.yml` (its field ids are `problem`
 * and `layer`; the reporter picks a category and writes the details).
 */
export function problemReportUrl(
  { problemId, layer }: ReportTarget,
  repoUrl = contentConfig.repoUrl
) {
  const query = new URLSearchParams({
    template: 'problem-report.yml',
    title: `Report: ${problemId}${layer ? ` (${layer})` : ''}`,
    problem: problemId,
  })
  if (layer) query.set('layer', layer)
  return `${repoUrl}/issues/new?${query}`
}
