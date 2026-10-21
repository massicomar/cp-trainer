/*
|--------------------------------------------------------------------------
| Edge globals
|--------------------------------------------------------------------------
|
| math(text): content text as HTML with its LaTeX typeset. Output it with
| triple braces, {{{ math(problem.summaryMd) }}}; it escapes everything else.
|
*/

import edge from 'edge.js'
import { renderMathText } from '#services/math_text'

edge.global('math', renderMathText)
