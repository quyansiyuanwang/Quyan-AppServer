import { performance } from "node:perf_hooks";
import type { IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import type { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { isCanonicalAgentId } from "@/iam/resources/agent-resources";
import type { TypedRequest } from "@/types/express";
import { ForbiddenError } from "@/util/errors";
export const agentIamDenied = () =>
  new ForbiddenError("Agent resource authorization unavailable", undefined, {
    messageKey: "permission.insufficientPermission",
  });
export function trustedAgentIdentity(userId: string, request?: TypedRequest) {
  const principal = request && getIamPrincipal(request);
  if (!request || !principal || principal.subjectUserId !== userId || !isCanonicalAgentId(userId))
    throw agentIamDenied();
  return { request, principal };
}
export async function filterAgentResources(
  iam: IamAuthorizationService,
  request: TypedRequest,
  principal: IamPrincipal,
  action: string,
  resources: readonly string[],
) {
  if (!resources.length) return [];
  const start = performance.now(),
    results = await iam.authorizeMany({
      principal,
      action,
      resources: [...resources],
      context: requestConditionContext(request, principal),
    });
  if (results.length !== resources.length || resources.some((_, index) => !results[index])) throw agentIamDenied();
  results.forEach((result, index) => {
    (request.iamDecisions ??= []).push({ ...result, action, resource: resources[index] });
    auditIamDecision({
      requestId: request.res?.locals.requestId,
      principal,
      action,
      resource: resources[index],
      result,
      evaluationLatencyMs: performance.now() - start,
      authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
      ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed: true } : {}),
      batchSize: resources.length,
      batchIndex: index,
    });
  });
  return resources.filter((_, index) => results[index].decision === "Allow");
}
