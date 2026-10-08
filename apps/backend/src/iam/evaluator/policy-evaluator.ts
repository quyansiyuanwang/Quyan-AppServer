import { isKnownIamAction, isValidIamResource } from "@quyan/shared";
import type {
  IamEvaluationRequest,
  IamEvaluationResult,
  IamMatchedStatement,
  NormalizedIamPolicyDocument,
} from "@quyan/shared";
import { evaluateIamCondition, MissingIamConditionContextError } from "../condition/condition-evaluator";
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
  let missingConditionContext = false;
  for (const policy of policies) {
    // Fail closed even for malformed documents already persisted in storage.
    const document = parseIamPolicy(policy.document).document;
    document.Statement.forEach((statement, index) => {
      if (
        !statement.Action.some((pattern) => matchIamPattern(pattern, request.action)) ||
        !statement.Resource.some((pattern) => matchIamPattern(pattern, request.resource))
      )
        return;
      try {
        if (!evaluateIamCondition(statement.Condition, request.context)) return;
      } catch (error) {
        if (!(error instanceof MissingIamConditionContextError)) throw error;
        missingConditionContext = true;
        return;
      }
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
  if (missingConditionContext)
    return { decision: "ImplicitDeny", reason: "missing-condition-context", matchedStatements };
  if (matchedStatements.length) return { decision: "Allow", reason: "matched-allow", matchedStatements };
  return { decision: "ImplicitDeny", reason: "no-matching-allow", matchedStatements };
}
