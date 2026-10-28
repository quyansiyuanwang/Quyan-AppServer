import {
  actionForPermission,
  getIamActionDefinition,
  getIamConditionKey,
  getIamResourcePatternTypes,
  matchIamPattern,
  Permission,
} from "@quyan/shared";
import type { IamCondition, IamConditionContext, NormalizedIamStatement } from "@quyan/shared";
import { evaluateIamCondition, MissingIamConditionContextError } from "../condition/condition-evaluator";
import { isProvenPatternSubset } from "../delegation/delegation-check";
import { parseIamPolicy } from "../parser/policy-parser";
import type { IamPolicyInput } from "./policy-evaluator";

/** Unknown resource/request attributes must not conceal a potentially usable UI workflow. */
function knownCondition(condition: IamCondition | undefined, context: IamConditionContext): boolean | undefined {
  let unknown = false;
  for (const [operator, keys] of Object.entries(condition ?? {}))
    for (const [key, expected] of Object.entries(keys)) {
      if (getIamConditionKey(key)?.source === "resource" || context[key] === undefined) {
        unknown = true;
        continue;
      }
      try {
        if (!evaluateIamCondition({ [operator]: { [key]: expected } }, context)) return false;
      } catch (error) {
        if (!(error instanceof MissingIamConditionContextError)) throw error;
        unknown = true;
      }
    }
  return unknown ? undefined : true;
}

/** Only reject intersections whose literal structural components prove them empty. */
function mayOverlap(a: string, b: string): boolean {
  if (!a.includes("*")) return matchIamPattern(b, a);
  if (!b.includes("*")) return matchIamPattern(a, b);
  const left = a.split(/[:/]/),
    right = b.split(/[:/]/);
  return (
    left.length !== right.length ||
    !left.some((part, index) => !part.includes("*") && !right[index].includes("*") && part !== right[index])
  );
}

/** Each entry is an intersection of statement and authorization-scope resource patterns. */
function candidates(statement: NormalizedIamStatement, scope: IamPolicyInput["scope"]): string[][] {
  if (scope?.type === "resource-group")
    return scope.resources
      .filter((resource) => statement.Resource.some((pattern) => matchIamPattern(pattern, resource)))
      .map((resource) => [resource]);
  return statement.Resource.flatMap((resource) =>
    scope?.type === "resource" ? (mayOverlap(resource, scope.arn) ? [[resource, scope.arn]] : []) : [[resource]],
  );
}

function covers(
  patterns: readonly string[],
  statement: NormalizedIamStatement,
  scope: IamPolicyInput["scope"],
): boolean {
  if (!statement.Resource.some((resource) => patterns.some((pattern) => isProvenPatternSubset(pattern, resource))))
    return false;
  if (scope?.type === "resource") return patterns.some((pattern) => isProvenPatternSubset(pattern, scope.arn));
  if (scope?.type === "resource-group")
    return scope.resources.some((resource) => patterns.some((pattern) => isProvenPatternSubset(pattern, resource)));
  return true;
}

/**
 * Presentation-only upper bound, NEVER an authorization or delegation result.
 * Known-false conditions and proven covering Denies hide entries. Unknown resource conditions,
 * wildcard intersections and partial Denies are deferred to live per-resource authorization.
 * Inputs must come from loadPolicies, which validates identity, account, bindings and role sessions.
 */
export function projectIamUiPermissions(
  policies: readonly IamPolicyInput[],
  context: IamConditionContext,
): Permission[] {
  // Validate every document before projecting, even if its actions would not produce a UI entry.
  const entries = policies.flatMap((policy) =>
    parseIamPolicy(policy.document).document.Statement.map((statement) => ({
      statement,
      scope: policy.scope,
      condition: knownCondition(statement.Condition, context),
    })),
  );
  return Object.values(Permission).filter((permission) => {
    const action = actionForPermission(permission);
    const resourceTypes = getIamActionDefinition(action)!.resourceTypes;
    const matching = entries.filter(({ statement }) =>
      statement.Action.some((pattern) => matchIamPattern(pattern, action)),
    );
    const denies = matching.filter(({ statement, condition }) => statement.Effect === "Deny" && condition === true);
    return matching.some(
      ({ statement, scope, condition }) =>
        statement.Effect === "Allow" &&
        condition !== false &&
        candidates(statement, scope).some(
          (patterns) =>
            patterns.every(
              (pattern) =>
                pattern === "*" || getIamResourcePatternTypes(pattern).some((type) => resourceTypes.includes(type.id)),
            ) && !denies.some((deny) => covers(patterns, deny.statement, deny.scope)),
        ),
    );
  });
}
