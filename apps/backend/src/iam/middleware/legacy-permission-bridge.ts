import { getLogger, LogCategory } from "@/util/logger";
import { performance } from "node:perf_hooks";
import { actionForPermission } from "@quyan/shared";
import type { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { PermissionService } from "@/services/users/permission.service";
import type { TypedRequest } from "@/types/express";
import { ForbiddenError, UnauthorizedError } from "@/util/errors";
import { IamAuthorizationService } from "../iam-authorization.service";
import { getIamPrincipal } from "../request/principal-context";
import { ramAccountResourceResolver } from "../request/resource-resolvers";
import { auditIamDecision } from "../audit/iam-audit.service";
const logger = getLogger("IamLegacyBridge", LogCategory.SECURITY);
export async function authorizeLegacyPermissions(
  request: TypedRequest,
  permissions: Permission[],
  any: boolean,
): Promise<boolean> {
  if (!permissions.length) return false;
  const mode = env.security.iamAuthorizationMode;
  if (mode === "legacy") return legacyResult(request, permissions, any);
  const principal = getIamPrincipal(request);
  if (!principal)
    throw new UnauthorizedError("IAM principal missing", undefined, { messageKey: "permission.loginRequired" });
  const resource = await ramAccountResourceResolver({ request, principal });
  if (!resource)
    throw new ForbiddenError("IAM resource resolution failed", undefined, {
      messageKey: "iam.resourceResolutionFailed",
    });
  const legacyAllowed = mode === "shadow" ? await legacyResult(request, permissions, any) : undefined;
  const start = performance.now();
  try {
    const service = IamAuthorizationService.getInstance(),
      policies = await service.loadPolicies(principal);
    const { evaluatePolicies } = await import("../evaluator/policy-evaluator");
    const results = permissions.map((permission) => ({
      action: actionForPermission(permission),
      result: evaluatePolicies(policies, { action: actionForPermission(permission), resource }),
    }));
    for (const { action, result } of results) {
      (request.iamDecisions ??= []).push({ ...result, action, resource });
      auditIamDecision({
        requestId: request.res?.locals.requestId,
        principal,
        action,
        resource,
        result,
        evaluationLatencyMs: performance.now() - start,
        authorizationMode: mode,
        legacyAllowed,
      });
    }
    const allowed = any
      ? results.some((item) => item.result.decision === "Allow")
      : results.every((item) => item.result.decision === "Allow");
    return mode === "shadow" ? legacyAllowed! : allowed;
  } catch (error) {
    // Shadow leaves legacy enforcement intact, but never degrades an enforce request to legacy.
    if (mode === "shadow") {
      logger.warn("IAM shadow evaluation failed", {
        reason: "authorization-data-unavailable",
        principalUserId: principal.principalUserId,
      });
      return legacyAllowed!;
    }
    throw error;
  }
}
async function legacyResult(request: TypedRequest, permissions: Permission[], any: boolean): Promise<boolean> {
  const result = await PermissionService.getInstance().checkUserPermissions(request.user!.userId, permissions, {
    assumedRoleSessionId: request.user!.roleSessionId,
  });
  return any
    ? result.checkedPermissions.some((permission) => !result.missingPermissions?.includes(permission))
    : result.hasPermission;
}
