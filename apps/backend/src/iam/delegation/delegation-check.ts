import type { IamCondition, IamDelegationIssue, IamDelegationResult, NormalizedIamPolicyDocument } from "@quyan/shared";
import { IAM_ACTION_CATALOG, matchIamPattern } from "@quyan/shared";
import { parseIamPolicy } from "../parser/policy-parser";
/** A sufficient subset proof only. Any wildcard relationship we cannot establish is denied. */
export function isProvenPatternSubset(child: string, parent: string): boolean {
  if (child === parent || parent === "*") return true;
  if (!child.includes("*")) return matchIamPattern(parent, child);
  // Fixed structural separators give a conservative, compositional proof for ARN templates.
  const a = child.split(":"),
    b = parent.split(":");
  if (a.length !== 5 || b.length !== 5) return false;
  return a.every(
    (part, index) => part === b[index] || b[index] === "*" || (!part.includes("*") && matchIamPattern(b[index], part)),
  );
}
export function isProvenConditionSubset(child?: IamCondition, parent?: IamCondition): boolean {
  if (!parent) return true;
  if (!child) return false;
  return Object.entries(parent).every(([operator, keys]) =>
    Object.entries(keys).every(([key, parentValues]) => {
      const childValues = child[operator]?.[key];
      if (childValues === undefined) return false;
      const allowed = new Set([parentValues].flat().map((value) => JSON.stringify(value)));
      // Same operator/key and fewer OR alternatives; additional clauses only restrict the child.
      return [childValues].flat().every((value) => allowed.has(JSON.stringify(value)));
    }),
  );
}
function mightOverlap(a: string, b: string): boolean {
  if (!a.includes("*")) return matchIamPattern(b, a);
  if (!b.includes("*")) return matchIamPattern(a, b);
  // Conservatively reject wildcard overlap unless incompatible literal ARN components prove separation.
  const x = a.split(":"),
    y = b.split(":");
  if (
    x.length === 5 &&
    y.length === 5 &&
    x.some((part, i) => !part.includes("*") && !y[i].includes("*") && part !== y[i])
  )
    return false;
  return true;
}
export function checkIamDelegation(
  candidate: NormalizedIamPolicyDocument,
  grants: readonly NormalizedIamPolicyDocument[],
): IamDelegationResult {
  const target = parseIamPolicy(candidate).document;
  const statements = grants.flatMap((policy) => parseIamPolicy(policy).document.Statement);
  const allows = statements.filter((statement) => statement.Effect === "Allow");
  const denies = statements.filter((statement) => statement.Effect === "Deny");
  const issues: IamDelegationIssue[] = [];
  let comparisons = 0;
  const maximumComparisons = 10000;
  target.Statement.forEach((statement, index) => {
    if (statement.Effect !== "Allow" || issues.length >= 100) return;
    const actions = IAM_ACTION_CATALOG.filter((action) =>
      statement.Action.some((pattern) => matchIamPattern(pattern, action)),
    );
    for (const action of actions)
      for (const resource of statement.Resource) {
        if (++comparisons > maximumComparisons) {
          if (!issues.some((issue) => issue.code === "proof-limit"))
            issues.push({ code: "proof-limit", statementId: statement.Sid ?? String(index), action });
          return;
        }
        if (issues.length >= 100) return;
        const matching = allows.filter((allow) => allow.Action.some((pattern) => matchIamPattern(pattern, action)));
        let code: IamDelegationIssue["code"] | undefined;
        if (
          denies.some(
            (deny) =>
              deny.Action.some((pattern) => matchIamPattern(pattern, action)) &&
              deny.Resource.some((pattern) => mightOverlap(resource, pattern)),
          )
        )
          code = "explicit-deny-overlap";
        else if (!matching.length) code = "missing-allow-coverage";
        else {
          const covering = matching.filter((allow) =>
            allow.Resource.some((pattern) => isProvenPatternSubset(resource, pattern)),
          );
          if (!covering.length) code = "unproven-resource-subset";
          else if (!covering.some((allow) => isProvenConditionSubset(statement.Condition, allow.Condition)))
            code = "unproven-condition-subset";
        }
        if (code) issues.push({ code, statementId: statement.Sid ?? String(index), action });
      }
  });
  return { allowed: issues.length === 0, issues };
}
