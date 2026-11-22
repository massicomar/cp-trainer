/*
|--------------------------------------------------------------------------
| Edge globals
|--------------------------------------------------------------------------
|
| math(text): content text as HTML with its LaTeX typeset. Output it with
| triple braces, {{{ math(problem.summaryMd) }}}; it escapes everything else.
|
| line(subjectId): the subject's Metro line, { id, code }, for the colored
| badges (`line--${id}` in app.css).
|
*/

import edge from 'edge.js'
import { lineOf } from '#services/lines'
import { renderMathText } from '#services/math_text'

edge.global('math', renderMathText)
edge.global('line', lineOf)
