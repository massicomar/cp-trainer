/**
 * The Metro look (D-103): every subject is a transit line with a short code
 * and a color. The colors live in app.css (`.line--<subject id>`); this is the
 * code shown on the line badge. Subjects the table doesn't know (a new one in
 * the taxonomy) still get a badge, from their id, and the neutral color.
 */
const CODES: Record<string, string> = {
  'dp': 'DP',
  'graphs': 'GR',
  'geometry': 'GEO',
  'number-theory': 'NT',
  'bsearch-dnc': 'BS',
  'segtree': 'ST',
  'other': '—',
}

export interface LineInfo {
  /** Subject id, used as the CSS modifier: `line--${id}`. */
  id: string
  code: string
}

export function lineOf(subjectId: string | null | undefined): LineInfo {
  const id = subjectId ?? 'other'
  return { id, code: CODES[id] ?? id.slice(0, 2).toUpperCase() }
}
