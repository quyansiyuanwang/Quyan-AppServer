import { createHash } from "node:crypto";
import { parseIamPolicy } from "../parser/policy-parser";
import type { IamPolicyInput } from "./policy-evaluator";
/** Compare current documents, versions and binding scopes independent of database row order. */
export function fingerprintIamPolicies(policies: readonly IamPolicyInput[]): string {
  const entries = policies
    .map((policy) =>
      JSON.stringify({
        policyId: policy.policyId,
        versionId: policy.versionId,
        authorizationId: policy.authorizationId,
        documentHash: parseIamPolicy(policy.document).documentHash,
        scope:
          policy.scope?.type === "resource-group"
            ? { ...policy.scope, resources: [...policy.scope.resources].sort() }
            : policy.scope,
      }),
    )
    .sort();
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}
