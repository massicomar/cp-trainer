import katex from 'katex'

/**
 * `$$…$$` (display) or `$…$` (inline, on one line). `\$` is a literal dollar.
 */
const MATH = /\$\$([\s\S]+?)\$\$|\$((?:\\.|[^$\\\n])+?)\$/g

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char])
}

/**
 * Content text (statements, explanations, options) as HTML: everything is
 * escaped, and the judge's LaTeX is typeset with KaTeX on the server, so the
 * page needs no JavaScript for math and HTMX swaps arrive already rendered.
 * Bad LaTeX shows as red source text instead of breaking the page. Line
 * breaks are left to CSS (`white-space: pre-line`).
 */
export function renderMathText(text: string | null | undefined): string {
  if (!text) return ''
  let html = ''
  let last = 0
  for (const match of text.matchAll(MATH)) {
    html += escapeHtml(text.slice(last, match.index).replace(/\\\$/g, '$'))
    const [source, display, inline] = match
    html += katex.renderToString(display ?? inline, {
      displayMode: display !== undefined,
      throwOnError: false,
      output: 'htmlAndMathml',
    })
    last = match.index + source.length
  }
  return html + escapeHtml(text.slice(last).replace(/\\\$/g, '$'))
}
