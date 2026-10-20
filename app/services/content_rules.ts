/**
 * Authoring rules that content CI checks but `content:sync` doesn't need:
 * the URL host allowlist (an error) and the "statement names the technique"
 * lint (a warning, since statements are copied exactly).
 * The contribute page runs them so authors see problems before opening a PR.
 *
 * Copied from cp-trainer-content/scripts/validate.ts. Keep the two in sync;
 * CI is the one that decides.
 */

export const ALLOWED_HOSTS = [
  'cses.fi',
  'codeforces.com',
  'atcoder.jp',
  'www.spoj.com',
  'spoj.com',
  'open.kattis.com',
  'leetcode.com',
  'usaco.org',
  'www.usaco.org',
  'acm.timus.ru',
  'judge.yosupo.jp',
  'oj.uz',
  'www.luogu.com.cn',
  'szkopul.edu.pl',
]

export const LEAK_WORDS = [
  'dynamic programming',
  'dp',
  'memoiz',
  'knapsack',
  'bitmask',
  'digit dp',
  'bfs',
  'dfs',
  'breadth-first',
  'depth-first',
  'dijkstra',
  'bellman',
  'floyd',
  'kruskal',
  'prim',
  'spanning tree',
  'topological',
  'union-find',
  'union find',
  'disjoint set',
  'dsu',
  'lca',
  'strongly connected',
  'scc',
  '2-sat',
  'max flow',
  'maximum flow',
  'min cut',
  'bipartite matching',
  'convex hull',
  'rotating calipers',
  'cross product',
  'shoelace',
  "pick's theorem",
  'sweep line',
  'line sweep',
  'sieve',
  'totient',
  'euler phi',
  'chinese remainder',
  'crt',
  'modular inverse',
  'fermat',
  'miller',
  'pollard',
  'inclusion-exclusion',
  'inclusion exclusion',
  'möbius',
  'mobius',
  'extended euclid',
  'binary search',
  'ternary search',
  'divide and conquer',
  'divide & conquer',
  'meet in the middle',
  'two pointers',
  'sliding window',
  'merge sort',
  'segment tree',
  'fenwick',
  'binary indexed',
  'bit tree',
  'lazy propagation',
  'sparse table',
  'prefix sum',
  'persistent',
  "mo's algorithm",
  'greedy',
]

/**
 * Technique words found in a summary, as whole words (same matching as CI).
 */
export function leakedWords(summary: string): string[] {
  const text = summary.toLowerCase()
  return LEAK_WORDS.filter((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(text)
  })
}

export function hostAllowed(url: string): boolean {
  try {
    return ALLOWED_HOSTS.includes(new URL(url).host)
  } catch {
    return false
  }
}
