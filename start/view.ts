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
| canSignIn: GitHub or the dev login is set up, so the header offers "Sign in".
|
*/

import edge from 'edge.js'
import env from '#start/env'
import { lineOf } from '#services/lines'
import { renderMathText } from '#services/math_text'

edge.global('math', renderMathText)
edge.global('line', lineOf)
edge.global(
  'canSignIn',
  Boolean(
    (env.get('GITHUB_CLIENT_ID') && env.get('GITHUB_CLIENT_SECRET')) || env.get('AUTH_DEV_LOGIN')
  )
)
