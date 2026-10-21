import { readFile } from 'node:fs/promises'
import { test } from '@japa/runner'
import { extractProblem } from '#services/statement_extractors'

/** Real pages saved from the judges (Codeforces / SPOJ: their structure, trimmed). */
const page = (name: string) =>
  readFile(new URL(`../fixtures/judges/${name}.html`, import.meta.url), 'utf8')

test.group('Statement extractors', () => {
  test('CSES: statement, Input/Output, constraints, title', async ({ assert }) => {
    const problem = extractProblem('CSES', await page('cses'))

    assert.equal(problem.title, 'Dice Combinations')
    assert.isTrue(problem.statement.startsWith('Your task is to count the number of ways'))
    assert.include(problem.statement, '\n\nInput\n\nThe only input line has an integer $n$.')
    assert.include(problem.statement, 'Print the number of ways modulo $10^9+7$.')
    assert.notInclude(problem.statement, 'Constraints')
    assert.notInclude(problem.statement, 'Example')
    assert.equal(problem.constraints, '$1 \\le n \\le 10^6$')
    assert.isNull(problem.difficulty)
  })

  test('AtCoder: English statement, input format, constraints, title without the letter', async ({
    assert,
  }) => {
    const problem = extractProblem('AtCoder', await page('atcoder'))

    assert.equal(problem.title, 'Frog 1')
    assert.include(problem.statement, '$|h_i - h_j|$')
    assert.include(problem.statement, '$N$\n$h_1$ $h_2$ $\\ldots$ $h_N$')
    assert.notInclude(problem.statement, 'Sample')
    assert.equal(
      problem.constraints,
      'All values in input are integers.; $2 \\leq N \\leq 10^5$; $1 \\leq h_i \\leq 10^4$'
    )
  })

  test('Kattis: statement, title and its own difficulty rating', async ({ assert }) => {
    const problem = extractProblem('Kattis', await page('kattis'))

    assert.equal(problem.title, 'Polygon Area')
    assert.isTrue(problem.statement.startsWith('Compute the area of a simple polygon'))
    assert.include(problem.statement, '($3 \\leq n \\leq 1\\, 000$)')
    assert.notInclude(problem.statement, 'CCW 50.0') // samples left out
    assert.deepEqual(problem.difficulty, { tier: 'easy', scale: 'kattis', value: '1.8' })
  })

  test('Codeforces: $$$ math becomes $, notes and samples left out', async ({ assert }) => {
    const problem = extractProblem('Codeforces', await page('codeforces'))

    assert.equal(problem.title, 'Boredom')
    assert.include(problem.statement, 'denote it $a_k$')
    assert.include(
      problem.statement,
      'Input\n\nThe first line contains integer $n$ ($1 \\le n \\le 10^5$)'
    )
    assert.notInclude(problem.statement, 'Note')
    assert.notInclude(problem.statement, '$$$')
  })

  test('SPOJ: statement with Input / Output, example left out', async ({ assert }) => {
    const problem = extractProblem('SPOJ', await page('spoj'))

    assert.include(
      problem.statement,
      'First line contains $T$, the number of test cases.\nThen $T$ lines follow.'
    )
    assert.notInclude(problem.statement, 'Example')
  })
})
