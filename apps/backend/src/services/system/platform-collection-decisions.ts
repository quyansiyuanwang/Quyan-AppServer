import { performance } from "node:perf_hooks";
import type { IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import type { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { requestConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
/** A single policy decision protocol for related platform contributions, including safe audit. */
export async function platformCollectionDecisions(
  iam: Pick<IamAuthorizationService, "authorizeMany">,
  input: { action: string; principal: IamPrincipal; request: TypedRequest; resources: readonly string[] },
) {
  const { action, principal, request, resources } = input,
    limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
  if (resources.length > limit) throw iamAccountDenied();
  if (!resources.length) return [];
  const started = performance.now();
  const results = await iam.authorizeMany({
    principal,
    action,
    resources: [...resources],
    context: requestConditionContext(request, principal),
  });
  if (
    !Array.isArray(results) ||
    results.length !== resources.length ||
    results.some((result) => !result || !["Allow", "ExplicitDeny", "ImplicitDeny"].includes(result.decision))
  )
    throw iamAccountDenied();
  const attached = (request.iamDecisions ??= []);
  attached.splice(0, Math.max(0, attached.length + results.length - limit));
  results.forEach((result, index) => {
    attached.push({ ...result, action, resource: resources[index]! });
    auditIamDecision({
      requestId: request.res?.locals.requestId,
      principal,
      action,
      resource: resources[index]!,
      result,
      evaluationLatencyMs: performance.now() - started,
      authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
      ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed: true } : {}),
    });
  });
  return results.map((result) => result.decision);
}
