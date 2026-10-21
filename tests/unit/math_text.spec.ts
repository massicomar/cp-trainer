import { test } from '@japa/runner'
import edge from 'edge.js'
import { renderMathText } from '#services/math_text'

test.group('renderMathText', () => {
  test('typesets inline math and keeps the text around it', ({ assert }) => {
    const html = renderMathText('There are $N$ stones, $1 \\leq N \\leq 10^5$.')

    assert.include(html, 'There are ')
    assert.include(html, ' stones, ')
    assert.include(html, 'class="katex"')
    assert.include(html, 'class="katex-html"') // the typeset version
    // The source survives only inside MathML's annotation (screen readers, copy).
    assert.include(
      html,
      '<annotation encoding="application/x-tex">1 \\leq N \\leq 10^5</annotation>'
    )
    assert.notInclude(html, '$')
  })

  test('typesets display math', ({ assert }) => {
    assert.include(renderMathText('Find $$\\sum_{i=1}^n a_i$$'), 'katex-display')
  })

  test('escapes HTML in the text', ({ assert }) => {
    const html = renderMathText('Print "YES" if a < b & <b>c</b>')

    assert.equal(html, 'Print &quot;YES&quot; if a &lt; b &amp; &lt;b&gt;c&lt;/b&gt;')
  })

  test('leaves lone and escaped dollars alone', ({ assert }) => {
    assert.equal(renderMathText('It costs \\$5'), 'It costs $5')
    assert.equal(renderMathText('Price: 5$ only'), 'Price: 5$ only')
  })

  test('inline math does not span lines', ({ assert }) => {
    assert.equal(renderMathText('a $b\nc$ d'), 'a $b\nc$ d')
  })

  test('shows bad LaTeX as an error instead of failing', ({ assert }) => {
    assert.include(renderMathText('$\\frac{1}$'), 'katex-error')
  })

  test('handles empty input', ({ assert }) => {
    assert.equal(renderMathText(''), '')
    assert.equal(renderMathText(null), '')
  })

  test('is available in templates as math()', async ({ assert }) => {
    const html = await edge.renderRaw('<p>{{{ math(text) }}}</p>', { text: 'Let $n$ <be>' })

    assert.include(html, 'class="katex"')
    assert.include(html, '&lt;be&gt;')
  })
})
