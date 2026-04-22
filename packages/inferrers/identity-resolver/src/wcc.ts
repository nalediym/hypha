/**
 * Weakly connected components via union-find. Given a list of (a, b) edges,
 * returns disjoint-set clusters. O((V + E) α(V)).
 */

export function weaklyConnectedComponents<T extends string>(
  nodes: readonly T[],
  edges: readonly { from: T; to: T }[],
): T[][] {
  const parent = new Map<T, T>();
  const rank = new Map<T, number>();
  for (const n of nodes) {
    parent.set(n, n);
    rank.set(n, 0);
  }

  const find = (x: T): T => {
    const p = parent.get(x);
    if (!p) return x;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };

  const union = (a: T, b: T): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    const rankA = rank.get(ra) ?? 0;
    const rankB = rank.get(rb) ?? 0;
    if (rankA < rankB) parent.set(ra, rb);
    else if (rankA > rankB) parent.set(rb, ra);
    else {
      parent.set(rb, ra);
      rank.set(ra, rankA + 1);
    }
  };

  for (const { from, to } of edges) {
    if (parent.has(from) && parent.has(to)) union(from, to);
  }

  const clusters = new Map<T, T[]>();
  for (const n of nodes) {
    const root = find(n);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(n);
  }
  return [...clusters.values()].filter((c) => c.length >= 1);
}
