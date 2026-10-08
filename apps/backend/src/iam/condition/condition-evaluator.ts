import { isIP } from "node:net";
import type { IamCondition, IamConditionContext, IamConditionScalar } from "@quyan/shared";
import { matchIamPattern } from "../evaluator/wildcard-matcher";
import { conditionBoolean, conditionDate, conditionNumber, iamConditionSchema } from "./condition-schema";
import { matchesIpCondition } from "./ip-condition";
export class MissingIamConditionContextError extends Error {
  constructor() {
    super("IAM condition context unavailable");
  }
}
// The Condition language supports ? in StringLike; Action/Resource remain star-only.
function like(pattern: string, actual: string): boolean {
  const width = actual.length + 1;
  let previous = new Uint8Array(width);
  previous[0] = 1;
  for (const token of pattern) {
    const next = new Uint8Array(width);
    if (token === "*") next[0] = previous[0];
    for (let j = 1; j < width; j++)
      next[j] =
        token === "*"
          ? previous[j] || next[j - 1]
          : previous[j - 1] && (token === "?" || token === actual[j - 1])
            ? 1
            : 0;
    previous = next;
  }
  return previous[actual.length] === 1;
}
function compare(operator: string, actual: number, expected: number): boolean {
  if (operator.endsWith("NotEquals")) return actual !== expected;
  if (operator.endsWith("LessThanEquals")) return actual <= expected;
  if (operator.endsWith("GreaterThanEquals")) return actual >= expected;
  if (operator.endsWith("LessThan")) return actual < expected;
  if (operator.endsWith("GreaterThan")) return actual > expected;
  return actual === expected;
}
function matches(operator: string, actual: IamConditionScalar, expected: IamConditionScalar): boolean {
  if (operator.startsWith("Numeric") || operator.startsWith("Date")) {
    const parse = operator.startsWith("Date") ? conditionDate : conditionNumber;
    const a = parse(actual),
      b = parse(expected);
    if (a === undefined || b === undefined) throw new MissingIamConditionContextError();
    return compare(operator, a, b);
  }
  if (operator === "Bool") {
    const a = conditionBoolean(actual),
      b = conditionBoolean(expected);
    if (a === undefined || b === undefined) throw new MissingIamConditionContextError();
    return a === b;
  }
  if (typeof actual !== "string" || typeof expected !== "string") throw new MissingIamConditionContextError();
  if (operator.includes("IpAddress")) {
    if (!isIP(actual)) throw new MissingIamConditionContextError();
    const result = matchesIpCondition(actual, expected, operator.endsWith("IncludeBorder"));
    return operator.startsWith("Not") ? !result : result;
  }
  const ignoreCase = operator.endsWith("IgnoreCase");
  const a = ignoreCase ? actual.toLowerCase() : actual,
    b = ignoreCase ? expected.toLowerCase() : expected;
  const result = operator.endsWith("Like") ? (b.includes("?") ? like(b, a) : matchIamPattern(b, a)) : a === b;
  return operator.startsWith("StringNot") ? !result : result;
}
export function evaluateIamCondition(condition: IamCondition | undefined, context: IamConditionContext = {}): boolean {
  if (!condition) return true;
  // Validate all clauses first: short-circuiting must never hide malformed conditions.
  const validated = iamConditionSchema.parse(condition);
  const results: boolean[] = [];
  for (const [operator, clause] of Object.entries(validated))
    for (const [key, expected] of Object.entries(clause)) {
      const actual = Object.hasOwn(context, key) ? context[key] : undefined;
      if (operator === "Null")
        results.push([expected].flat().some((value) => conditionBoolean(value) === (actual === undefined)));
      else {
        if (actual === undefined) throw new MissingIamConditionContextError();
        results.push([expected].flat().some((value) => matches(operator, actual, value)));
      }
    }
  return results.every(Boolean);
}
