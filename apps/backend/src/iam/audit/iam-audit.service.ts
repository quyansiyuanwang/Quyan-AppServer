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
  batchSize?: number;
  batchIndex?: number;
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
    matchedAuthorizationIds: [
      ...new Set(
        result.matchedStatements.flatMap((statement) => (statement.authorizationId ? [statement.authorizationId] : [])),
      ),
    ],
    matchedVersionIds: [
      ...new Set(result.matchedStatements.flatMap((statement) => (statement.versionId ? [statement.versionId] : []))),
    ],
    matchedStatementIds: result.matchedStatements.map((statement) => statement.policyId + ":" + statement.statementId),
    evaluationLatencyMs: input.evaluationLatencyMs,
    authorizationMode: input.authorizationMode,
    ...(input.batchSize === undefined ? {} : { batchSize: input.batchSize, batchIndex: input.batchIndex }),
    ...(input.legacyAllowed === undefined
      ? {}
      : {
          legacyAllowed: input.legacyAllowed,
          differsFromLegacy: input.legacyAllowed !== (result.decision === "Allow"),
        }),
  });
}

/** Accept only identifiers, never policy documents or arbitrary request payloads. */
export function auditIamManagement(input: {
  actorUserId: string;
  accountOwnerId: string;
  operation:
    | "create-authorization"
    | "delete-authorization"
    | "create-resource-group"
    | "add-resource-group-member"
    | "remove-resource-group-member"
    | "create-role-trust"
    | "update-role-trust"
    | "assume-role";
  targetId: string;
  policyId?: string;
  scopeType?: string;
  resourceArn?: string;
  requestId?: string;
}): void {
  logger.info("IAM management mutation", {
    requestId: input.requestId,
    principalUserId: input.actorUserId,
    accountOwnerId: input.accountOwnerId,
    operation: input.operation,
    targetId: input.targetId,
    policyId: input.policyId,
    scopeType: input.scopeType,
    ...(input.resourceArn ? { resourceHash: createHash("sha256").update(input.resourceArn).digest("hex") } : {}),
  });
}
