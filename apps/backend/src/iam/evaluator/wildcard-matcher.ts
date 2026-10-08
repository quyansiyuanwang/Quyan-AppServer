/** Greedy wildcard matching without regex/backtracking. Only * has special meaning. */
export function matchIamPattern(pattern: string, actual: string): boolean {
  let p = 0,
    a = 0,
    star = -1,
    retry = 0;
  while (a < actual.length) {
    if (p < pattern.length && pattern[p] !== "*" && pattern[p] === actual[a]) {
      p++;
      a++;
      continue;
    }
    if (pattern[p] === "*") {
      star = p++;
      retry = a;
      continue;
    }
    if (star === -1) return false;
    p = star + 1;
    a = ++retry;
  }
  while (pattern[p] === "*") p++;
  return p === pattern.length;
}
