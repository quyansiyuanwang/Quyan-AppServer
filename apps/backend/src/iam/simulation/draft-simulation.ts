import { isIamResourceInAccount, type IamEvaluationRequest, type IamEvaluationResult } from "@quyan/shared";
import { BadRequestError } from "@/util/errors";
import { parseIamPolicy } from "../parser/policy-parser";
import { assertIamPolicyAccount } from "../parser/policy-account";
import { evaluatePolicies } from "../evaluator/policy-evaluator";

/** Isolated draft evaluation: no stored bindings, no grant or publication side effects. */
export function evaluateIdentityPolicyDraft(
  documentText: string,
  accountOwnerId: string,
  request: IamEvaluationRequest,
): IamEvaluationResult {
  const document = parseIdentityPolicyDraft(documentText, accountOwnerId);
  if (!isIamResourceInAccount(request.resource, accountOwnerId))
    return { decision: "ImplicitDeny", reason: "invalid-request", matchedStatements: [] };
  return evaluatePolicies([{ policyId: "simulation:draft", document }], request);
}
export function parseIdentityPolicyDraft(documentText: string, accountOwnerId: string) {
  let parsed;
  try {
    parsed = parseIamPolicy(documentText);
    assertIamPolicyAccount(parsed.document, accountOwnerId);
  } catch {
    throw new BadRequestError("Invalid IAM simulation draft", undefined, { messageKey: "iam.invalidPolicy" });
  }
  return parsed.document;
}
