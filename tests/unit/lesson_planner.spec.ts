import { test } from '@japa/runner'
import { pickProblems, type Candidate, type PlayerHistory } from '#services/lesson_planner'
import { seededRandom } from '#services/random'
import type { Tier } from '#types/content'

function candidate(id: string, pool: string, extra: Partial<Candidate> = {}): Candidate {
  return { id, pool, tier: 'easy' as Tier, distractor: false, pairWith: [], ...extra }
}

const fresh: PlayerHistory = { seen: new Set(), review: new Set() }

test.group('LessonPlanner.pickProblems', () => {
  test('goes round-robin over the selected subjects', ({ assert }) => {
    const candidates = ['a', 'b', 'c'].flatMap((pool) =>
      [1, 2, 3].map((n) => candidate(`${pool}${n}`, pool))
    )

    for (const seed of ['x', 'y', 'z']) {
      const pools = pickProblems(candidates, ['a', 'b', 'c'], fresh, seededRandom(seed)).map(
        (id) => id[0]
      )
      assert.lengthOf(pools, 5)
      // Every subject gets a turn before any gets a second one.
      assert.equal(new Set(pools.slice(0, 3)).size, 3)
      assert.deepEqual(pools.slice(3), pools.slice(0, 2))
    }
  })

  test('with one subject, all problems come from it', ({ assert }) => {
    const candidates = [1, 2, 3, 4, 5, 6].map((n) => candidate(`dp${n}`, 'dp'))

    const picked = pickProblems(candidates, ['dp'], fresh, seededRandom('s'))

    assert.lengthOf(picked, 5)
  })

  test('puts unseen problems first, easy to hard, then review, then the rest', ({ assert }) => {
    const candidates = [
      candidate('seen-ok', 'a'),
      candidate('seen-review', 'a'),
      candidate('hard', 'a', { tier: 'hard' }),
      candidate('easy', 'a', { tier: 'easy' }),
      candidate('medium', 'a', { tier: 'medium' }),
    ]
    const history: PlayerHistory = {
      seen: new Set(['seen-ok', 'seen-review']),
      review: new Set(['seen-review']),
    }

    const picked = pickProblems(candidates, ['a'], history, seededRandom('s'))

    assert.deepEqual(picked, ['easy', 'medium', 'hard', 'seen-review', 'seen-ok'])
  })

  test('puts an unseen pairWith partner right after its problem', ({ assert }) => {
    const candidates = [
      candidate('a1', 'a', { pairWith: ['b9'] }),
      candidate('b1', 'b'),
      candidate('b9', 'b', { tier: 'hard', pairWith: ['a1'] }),
    ]

    for (const seed of ['p', 'q', 'r', 's']) {
      const picked = pickProblems(candidates, ['a', 'b'], fresh, seededRandom(seed))
      assert.sameMembers(picked, ['a1', 'b1', 'b9'])
      const i = picked.indexOf('a1')
      const j = picked.indexOf('b9')
      assert.equal(Math.abs(i - j), 1)
    }
  })

  test('does not pull in a partner the player has already seen', ({ assert }) => {
    const candidates = [
      candidate('a1', 'a', { pairWith: ['a2'] }),
      candidate('a2', 'a'),
      candidate('a3', 'a'),
    ]
    const history: PlayerHistory = { seen: new Set(['a2']), review: new Set() }

    const picked = pickProblems(candidates, ['a'], history, seededRandom('s'), 2)

    assert.deepEqual(picked, ['a1', 'a3'])
  })

  test('allows at most one distractor per lesson', ({ assert }) => {
    const candidates = [
      candidate('g1', 'dp', { distractor: true }),
      candidate('g2', 'dp', { distractor: true }),
      candidate('g3', 'dp', { distractor: true }),
      candidate('d1', 'dp', { tier: 'hard' }),
    ]

    const picked = pickProblems(candidates, ['dp'], fresh, seededRandom('s'))

    assert.lengthOf(picked, 2)
    assert.include(picked, 'd1')
  })

  test('returns a shorter lesson when fewer problems match', ({ assert }) => {
    const candidates = [candidate('a1', 'a'), candidate('b1', 'b')]

    assert.sameMembers(pickProblems(candidates, ['a', 'b', 'c'], fresh, seededRandom('s')), [
      'a1',
      'b1',
    ])
    assert.deepEqual(pickProblems([], ['a'], fresh, seededRandom('s')), [])
  })
})
