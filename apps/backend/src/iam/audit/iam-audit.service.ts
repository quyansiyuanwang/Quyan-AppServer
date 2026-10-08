import { createHash } from "node:crypto";
import type { IamAuthorizationMode, IamEvaluationResult, IamPrincipal } from "@quyan/shared";
import { getLogger, LogCategory } from "@/util/logger";
const logger = getLogger("IamAuthorization", LogCategory.SECURITY);
export function auditIamDecision(input: {
  requestId?: string;
  principal: IamPrincipal;
  action: string;
  resource: string;
  result: IamEvaluationResult;
  evaluationLatencyMs: number;
  authorizationMode: IamAuthorizationMode;
  legacyAllowed?: boolean;
}): void {
  const { principal, result } = input;
  logger.info("IAM decision", {
    requestId: input.requestId,
    principalUserId: principal.principalUserId,
    subjectType: principal.subjectType,
    accountOwnerId: principal.accountOwnerId,
    action: input.action,
    resourceHash: createHash("sha256").update(input.resource).digest("hex"),
    decision: result.decision,
    reason: result.reason,
    matchedPolicyIds: [...new Set(result.matchedStatements.map((statement) => statement.policyId))],
    matchedVersionIds: [
      ...new Set(result.matchedStatements.flatMap((statement) => (statement.versionId ? [statement.versionId] : []))),
    ],
    matchedStatementIds: result.matchedStatements.map((statement) => statement.policyId + ":" + statement.statementId),
    evaluationLatencyMs: input.evaluationLatencyMs,
    authorizationMode: input.authorizationMode,
    ...(input.legacyAllowed === undefined
      ? {}
      : {
          legacyAllowed: input.legacyAllowed,
          differsFromLegacy: input.legacyAllowed !== (result.decision === "Allow"),
        }),
  });
}
