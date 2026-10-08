import type { NormalizedIamPolicyDocument } from "@quyan/shared";
import { matchIamPattern } from "@quyan/shared";
import type { IamPolicyInput } from "../evaluator/policy-evaluator";
import { isProvenPatternSubset } from "./delegation-check";
/** Never discard relation scope when proving a grant is delegatable. */
export function projectScopedPolicyForDelegation(input: IamPolicyInput): NormalizedIamPolicyDocument | undefined {
  if (!input.scope || input.scope.type === "account") return input.document;
  const scope = input.scope;
  const statements = input.document.Statement.flatMap((statement) => {
    const resources =
      scope.type === "resource-group"
        ? scope.resources.filter((resource) => statement.Resource.some((pattern) => matchIamPattern(pattern, resource)))
        : statement.Resource.flatMap((pattern) => {
            if (isProvenPatternSubset(pattern, scope.arn)) return [pattern];
            if (isProvenPatternSubset(scope.arn, pattern)) return [scope.arn];
            // Unknown Deny intersections must not be lost. A broader conservative Deny is safe.
            return statement.Effect === "Deny" ? [pattern] : [];
          });
    return resources.length ? [{ ...statement, Resource: [...new Set(resources)] }] : [];
  });
  return statements.length ? { Version: "1", Statement: statements } : undefined;
}
