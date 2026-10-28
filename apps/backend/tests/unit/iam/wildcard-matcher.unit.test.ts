import { describe, expect, it } from "vitest";
import { matchIamPattern } from "../../../src/iam/evaluator/wildcard-matcher";
describe("IAM star-only matcher", () => {
  it.each([
    ["*", "quyan:ram:DeleteUser", true],
    ["quyan:ram:*", "quyan:ram:ReadUser", true],
    ["quyan:ram:Read*", "quyan:ram:ReadUser", true],
    ["a*b*c", "axybzxc", true],
    ["a**b", "ab", true],
    ["a*b", "xaby", false],
    ["a*b", "abx", false],
    ["foo.bar", "fooXbar", false],
    ["a+b", "aaab", false],
    ["a?b", "axb", false],
    ["[a]", "a", false],
    ["a(b)", "a(b)", true],
    ["a$", "a$", true],
    ["a\\b", "a\\b", true],
    ["Describe*", "describeDomains", false],
    ["*", "", true],
    ["", "", true],
  ])("%s against %s", (pattern, actual, expected) => expect(matchIamPattern(pattern, actual)).toBe(expected));
  it("matches an independent dynamic-programming model exhaustively on short inputs", () => {
    const strings = (alphabet: string, n: number): string[] =>
      n === 0 ? [""] : ["", ...strings(alphabet, n - 1).flatMap((s) => [...alphabet].map((c) => s + c))];
    const reference = (p: string, s: string): boolean => {
      const dp = Array.from({ length: p.length + 1 }, () => Array<boolean>(s.length + 1).fill(false));
      dp[0][0] = true;
      for (let i = 1; i <= p.length; i++)
        for (let j = 0; j <= s.length; j++)
          dp[i][j] =
            p[i - 1] === "*"
              ? dp[i - 1][j] || (j > 0 && dp[i][j - 1])
              : j > 0 && p[i - 1] === s[j - 1] && dp[i - 1][j - 1];
      return dp[p.length][s.length];
    };
    for (const p of new Set(strings("ab*", 4)))
      for (const s of new Set(strings("ab", 4))) expect(matchIamPattern(p, s)).toBe(reference(p, s));
  });
});
