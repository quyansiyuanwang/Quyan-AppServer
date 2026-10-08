import { isKnownIamAction, isValidIamResource } from "@quyan/shared";
import type {
  IamEvaluationRequest,
  IamEvaluationResult,
  IamMatchedStatement,
  NormalizedIamPolicyDocument,
} from "@quyan/shared";
import { parseIamPolicy } from "../parser/policy-parser";
import { matchIamPattern } from "./wildcard-matcher";
export interface IamPolicyInput {
  policyId: string;
  versionId?: string;
  document: NormalizedIamPolicyDocument;
}
export function evaluatePolicies(
  policies: readonly IamPolicyInput[],
  request: IamEvaluationRequest,
): IamEvaluationResult {
  if (!isKnownIamAction(request.action) || !isValidIamResource(request.resource))
    return { decision: "ImplicitDeny", reason: "invalid-request", matchedStatements: [] };
  const matchedStatements: IamMatchedStatement[] = [];
  for (const policy of policies) {
    // Fail closed even for malformed documents already persisted in storage.
    const document = parseIamPolicy(policy.document).document;
    document.Statement.forEach((statement, index) => {
      if (
        !statement.Action.some((pattern) => matchIamPattern(pattern, request.action)) ||
        !statement.Resource.some((pattern) => matchIamPattern(pattern, request.resource))
      )
        return;
      matchedStatements.push({
        policyId: policy.policyId,
        ...(policy.versionId ? { versionId: policy.versionId } : {}),
        statementId: statement.Sid ?? String(index),
        effect: statement.Effect,
      });
    });
  }
  if (matchedStatements.some((statement) => statement.effect === "Deny"))
    return { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements };
  if (matchedStatements.length) return { decision: "Allow", reason: "matched-allow", matchedStatements };
  return { decision: "ImplicitDeny", reason: "no-matching-allow", matchedStatements };
}
