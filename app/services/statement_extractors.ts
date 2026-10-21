import { parse as parseHtml, type HTMLElement, type Node } from 'node-html-parser'
import type { Tier } from '#types/content'

/**
 * Pulls problem statements out of judge pages (D-062, D-068), for
 * `/contribute` "From a link" and `node ace content:fetch-statements`.
 *
 * The statement is the body plus its Input and Output sections. Left out: the
 * title, limits, Constraints (they go in `constraints`), samples and notes.
 * Math stays as the judge's LaTeX, written `$…$` (`$$…$$` for display).
 */

export type Judge = 'CSES' | 'AtCoder' | 'Kattis' | 'Codeforces' | 'SPOJ'

/** Judges the server can fetch. Codeforces and SPOJ sit behind a bot check. */
export const FETCHABLE: Judge[] = ['CSES', 'AtCoder', 'Kattis']

export interface ExtractedProblem {
  title: string | null
  statement: string
  /** The judge's Constraints section, one item after another; null if it has none. */
  constraints: string | null
  difficulty: { tier: Tier; scale: string; value: string } | null
}

/** Like node-html-parser's parse, but also parses inside <pre> (input formats use <var>). */
function parse(html: string) {
  return parseHtml(html, { blockTextElements: { script: true, noscript: true, style: true } })
}

const ELEMENT = 1
const TEXT = 3
const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'ul',
  'ol',
  'pre',
  'table',
  'center',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
])

function isElement(node: Node): node is HTMLElement {
  return node.nodeType === ELEMENT
}

function tag(node: HTMLElement) {
  return (node.rawTagName ?? '').toLowerCase()
}

function hasClass(node: HTMLElement, name: string) {
  return (node.getAttribute('class') ?? '').split(/\s+/).includes(name)
}

/**
 * Inline content: text plus math, as one string. Line breaks in the HTML
 * source are just spaces (as a browser shows them); only <br> breaks a line.
 * Inside <pre>, text is kept as is.
 */
function inline(node: Node, pre = false): string {
  if (node.nodeType === TEXT) return pre ? node.text : node.text.replace(/\s+/g, ' ')
  if (!isElement(node)) return ''
  const name = tag(node)
  if (name === 'br') return '\n'
  if (name === 'img') return '[image]'
  // Math is always one line: HTML sources sometimes wrap inside a formula.
  const math = () => node.text.replace(/\s+/g, ' ').trim()
  if (name === 'var') return `$${math()}$` // AtCoder
  if (hasClass(node, 'math-inline')) return `$${math()}$` // CSES
  if (hasClass(node, 'math-display')) return `$$${math()}$$` // CSES
  if (hasClass(node, 'tex2jax_process')) return math() // Kattis: already $…$
  return node.childNodes.map((child) => inline(child, pre)).join('')
}

function tidy(text: string) {
  return (
    text
      // Codeforces writes math as $$$…$$$ (and $$$$$$…$$$$$$ for display).
      .replace(/\${6}([\s\S]+?)\${6}/g, '$$$$$1$$$$')
      .replace(/\${3}([\s\S]+?)\${3}/g, '$$$1$$')
      .replace(/[ \t\r\f\v]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .trim()
  )
}

/** Block content: paragraphs, lists and preformatted text, in order. */
function blocks(node: HTMLElement | Node[]): string[] {
  const nodes = Array.isArray(node) ? node : node.childNodes
  const out: string[] = []
  let pending = ''
  const flush = () => {
    const text = tidy(pending)
    if (text) out.push(text)
    pending = ''
  }

  for (const child of nodes) {
    if (!isElement(child) || !BLOCK_TAGS.has(tag(child))) {
      pending += inline(child)
      continue
    }
    flush()
    const name = tag(child)
    if (name === 'ul' || name === 'ol') {
      const items = child.childNodes.filter((n) => isElement(n) && tag(n) === 'li')
      const lines = items.map((li, i) => `${name === 'ol' ? `${i + 1}.` : '-'} ${tidy(inline(li))}`)
      if (lines.length) out.push(lines.join('\n'))
    } else if (name === 'pre') {
      // Input formats: keep the line breaks exactly.
      const text = child.childNodes
        .map((n) => inline(n, true))
        .join('')
        .replace(/\r\n?/g, '\n')
        .replace(/\s+$/, '')
      if (text.trim()) out.push(text)
    } else if (name === 'table') {
      // Statements don't put prose in tables; samples are handled per judge.
      continue
    } else if (/^h[1-6]$/.test(name)) {
      const text = tidy(inline(child))
      if (text) out.push(text)
    } else {
      out.push(...blocks(child))
    }
  }
  flush()
  return out
}

function joinBlocks(parts: string[]) {
  return parts.filter(Boolean).join('\n\n').trim()
}

/** The items of a Constraints list, on one line. */
function listItems(nodes: Node[]) {
  const items: string[] = []
  for (const node of nodes) {
    if (!isElement(node)) continue
    const lis = tag(node) === 'li' ? [node] : node.querySelectorAll('li')
    for (const li of lis) items.push(tidy(inline(li)))
  }
  return items.filter(Boolean).join('; ') || null
}

/** Keeps the statement plus its Input / Output sections, by heading. */
const KEEP = new Set(['input', 'output'])

/**
 * For judges that put sections one after another under headings (CSES,
 * Kattis, SPOJ): the statement, Input/Output, and the Constraints nodes.
 */
function sectioned(children: Node[], isHeading: (node: HTMLElement) => boolean) {
  const kept: string[] = []
  const constraints: Node[] = []
  let section = 'statement'
  for (const child of children) {
    if (isElement(child) && isHeading(child)) {
      section = tidy(child.text).toLowerCase()
      if (KEEP.has(section)) kept.push(tidy(child.text))
      continue
    }
    if (section === 'constraints') constraints.push(child)
    if (section !== 'statement' && !KEEP.has(section)) continue
    kept.push(...blocks([child]))
  }
  return { statement: joinBlocks(kept), constraints: listItems(constraints) }
}

function cses(html: string): ExtractedProblem {
  const root = parse(html)
  const md = root.querySelector('div.md')
  if (!md) throw new Error('no div.md on the page')
  const { statement, constraints } = sectioned(md.childNodes, (n) => tag(n) === 'h1')
  const title = root.querySelector('.title-block h1')
  return { title: title ? tidy(title.text) : null, statement, constraints, difficulty: null }
}

function atcoder(html: string): ExtractedProblem {
  const root = parse(html)
  const english =
    root.querySelector('#task-statement span.lang-en') ?? root.querySelector('#task-statement')
  if (!english) throw new Error('no #task-statement on the page')
  const kept: string[] = []
  let constraints: string | null = null
  for (const section of english.querySelectorAll('section')) {
    const heading = section.querySelector('h3')
    const title = heading ? tidy(heading.text) : ''
    const key = title.toLowerCase()
    if (key === 'constraints') constraints = listItems(section.childNodes)
    if (key !== 'problem statement' && !KEEP.has(key)) continue
    heading?.remove()
    if (KEEP.has(key)) kept.push(title)
    kept.push(...blocks(section))
  }
  // "A - Frog 1" (plus an Editorial link) → "Frog 1"
  const h2 = root.querySelector('span.h2')
  const raw = h2
    ? h2.childNodes
        .filter((n) => n.nodeType === TEXT)
        .map((n) => n.text)
        .join(' ')
    : ''
  const title = tidy(raw).replace(/^[A-Z][A-Z0-9]* - /, '') || null
  return { title, statement: joinBlocks(kept), constraints, difficulty: null }
}

function kattis(html: string): ExtractedProblem {
  const root = parse(html)
  const body = root.querySelector('div.problembody')
  if (!body) throw new Error('no div.problembody on the page')
  for (const extra of body.querySelectorAll('.illustration, table.sample')) extra.remove()
  const { statement } = sectioned(body.childNodes, (n) => /^h[23]$/.test(tag(n)))
  const title = root.querySelector('h1.book-page-heading')

  // Kattis rates difficulty with a number and its own Easy / Medium / Hard.
  let difficulty: ExtractedProblem['difficulty'] = null
  const card = root.querySelector('.metadata-difficulty-card')
  const value = card?.querySelector('.difficulty_number')?.text.replace(/\s+/g, ' ').trim()
  if (card && value) {
    const label = card.querySelector('.text-link')?.text.trim().toLowerCase()
    const tier = (['easy', 'medium', 'hard'] as Tier[]).find((t) => t === label) ?? 'medium'
    difficulty = { tier, scale: 'kattis', value }
  }
  return { title: title ? tidy(title.text) : null, statement, constraints: null, difficulty }
}

function codeforces(html: string): ExtractedProblem {
  const statement = parse(html).querySelector('.problem-statement')
  if (!statement) throw new Error('no .problem-statement in the captured page')
  const kept: string[] = []
  for (const child of statement.childNodes) {
    if (!isElement(child)) continue
    if (hasClass(child, 'header') || hasClass(child, 'sample-tests') || hasClass(child, 'note')) {
      continue
    }
    const title = child.querySelector('.section-title')
    if (hasClass(child, 'input-specification') || hasClass(child, 'output-specification')) {
      kept.push(title ? tidy(title.text) : '')
      title?.remove()
    } else if (title) {
      continue // other titled sections (interaction, scoring…): not part of the statement
    }
    kept.push(...blocks(child))
  }
  const title = statement.querySelector('.header .title')
  return {
    title: title ? tidy(title.text).replace(/^[A-Z][0-9]?\. /, '') : null,
    statement: joinBlocks(kept),
    constraints: null,
    difficulty: null,
  }
}

function spoj(html: string): ExtractedProblem {
  const body = parse(html).querySelector('#problem-body')
  if (!body) throw new Error('no #problem-body in the captured page')
  const { statement } = sectioned(body.childNodes, (n) => /^h[1-4]$/.test(tag(n)))
  return { title: null, statement, constraints: null, difficulty: null }
}

const EXTRACT: Record<Judge, (html: string) => ExtractedProblem> = {
  CSES: cses,
  AtCoder: atcoder,
  Kattis: kattis,
  Codeforces: codeforces,
  SPOJ: spoj,
}

export function extractProblem(judge: Judge, html: string): ExtractedProblem {
  return EXTRACT[judge](html)
}
