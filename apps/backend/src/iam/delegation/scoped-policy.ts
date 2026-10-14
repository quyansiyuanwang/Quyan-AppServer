import type { NormalizedIamPolicyDocument } from "@quyan/shared";
import { matchIamPattern } from "@quyan/shared";
import type { IamPolicyInput } from "../evaluator/policy-evaluator";
import { isProvenPatternSubset } from "./delegation-check";
/** Source grants use a lower bound; candidate authority must use an upper bound on unknown intersections. */
export function projectScopedPolicyForDelegation(
  input: IamPolicyInput,
  options?: { purpose: "candidate" },
): NormalizedIamPolicyDocument | undefined {
  if (!input.scope || input.scope.type === "account") return input.document;
  const scope = input.scope;
  const statements = input.document.Statement.flatMap((statement) => {
    const resources =
      scope.type === "resource-group"
        ? scope.resources.filter((resource) => statement.Resource.some((pattern) => matchIamPattern(pattern, resource)))
        : statement.Resource.flatMap((pattern) => {
            if (isProvenPatternSubset(pattern, scope.arn)) return [pattern];
            if (isProvenPatternSubset(scope.arn, pattern)) return [scope.arn];
            // Underestimating a candidate Allow would let an unprivileged actor grant a real intersection.
            // Unknown source Allows are omitted; candidate Allows and all Denies remain conservative.
            return statement.Effect === "Deny" || options?.purpose === "candidate" ? [pattern] : [];
          });
    return resources.length ? [{ ...statement, Resource: [...new Set(resources)] }] : [];
  });
  return statements.length ? { Version: "1", Statement: statements } : undefined;
}
