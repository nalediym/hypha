/**
 * Jaro–Winkler similarity. Classic string-distance metric, with the Winkler
 * boost that favors strings sharing a common prefix (good for names).
 *
 * Returns a value in [0, 1]. 1 = identical. We use 0.1 as the Winkler prefix
 * weight and cap prefix length at 4 characters, which is the standard
 * literature choice.
 */

const P = 0.1;
const MAX_PREFIX = 4;

export function jaroWinkler(a: string, b: string): number {
  const jaro = jaroDistance(a, b);
  if (jaro < 0.7) return jaro;
  let prefix = 0;
  const max = Math.min(MAX_PREFIX, a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * P * (1 - jaro);
}

function jaroDistance(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;

  const matchDistance = Math.max(la, lb) / 2 - 1;
  const aMatches = new Array<boolean>(la).fill(false);
  const bMatches = new Array<boolean>(lb).fill(false);

  let matches = 0;
  for (let i = 0; i < la; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, lb);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < la; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  return (matches / la + matches / lb + (matches - transpositions) / matches) / 3;
}
