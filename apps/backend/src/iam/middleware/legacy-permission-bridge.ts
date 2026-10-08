import { getLogger, LogCategory } from "@/util/logger";
import { performance } from "node:perf_hooks";
import { actionForPermission } from "@quyan/shared";
import type { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { PermissionService } from "@/services/users/permission.service";
import type { TypedRequest } from "@/types/express";
import { ForbiddenError, UnauthorizedError } from "@/util/errors";
import { IamAuthorizationService } from "../iam-authorization.service";
import { requestConditionContext } from "../request/condition-context";
import { getIamPrincipal } from "../request/principal-context";
import { ramAccountResourceResolver } from "../request/resource-resolvers";
import { assertIamAuthorizationDefinition } from "../request/authorization-definition";
import type { IamAuthorizationDefinition } from "../request/authorization-definition";
import { IAM_AUTHORIZATION_LIMITS, isSafeIamResourceBatch } from "../authorization-limits";
import { auditIamDecision } from "../audit/iam-audit.service";
const logger = getLogger("IamLegacyBridge", LogCategory.SECURITY);
export type LegacyIamDefinitions = IamAuthorizationDefinition | readonly IamAuthorizationDefinition[];
export function validateLegacyIamDefinitions(permissions: readonly Permission[], metadata?: LegacyIamDefinitions) {
  if (!metadata) return undefined;
  const definitions: readonly IamAuthorizationDefinition[] = Array.isArray(metadata)
    ? metadata
    : [metadata as IamAuthorizationDefinition];
  if (definitions.length !== permissions.length || definitions.length === 0)
    throw new Error("IAM definitions must cover each declared legacy permission");
  Array.from(definitions).forEach((definition, index) => {
    assertIamAuthorizationDefinition(definition);
    if (definition.action !== actionForPermission(permissions[index]))
      throw new Error("IAM action does not match declared legacy permission");
  });
  return definitions;
}
export async function authorizeLegacyPermissions(
  request: TypedRequest,
  permissions: Permission[],
  any: boolean,
  metadata?: LegacyIamDefinitions,
): Promise<boolean> {
  if (!permissions.length) return false;
  const definitions = validateLegacyIamDefinitions(permissions, metadata);
  const mode = env.security.iamAuthorizationMode;
  if (mode === "legacy") return legacyResult(request, permissions, any);
  const principal = getIamPrincipal(request);
  if (!principal)
    throw new UnauthorizedError("IAM principal missing", undefined, { messageKey: "permission.loginRequired" });
  const legacyAllowed = mode === "shadow" ? await legacyResult(request, permissions, any) : undefined;
  const start = performance.now();
  try {
    const resolved = await Promise.all(
      (
        definitions ??
        permissions.map((permission) => ({
          action: actionForPermission(permission),
          resourceKind: "account" as const,
          resource: ramAccountResourceResolver,
        }))
      ).map(async (definition) => {
        const value = await definition.resource({ request, principal });
        const resources = definition.resourceKind === "batch" ? value : [value];
        if (!isSafeIamResourceBatch(resources))
          throw new ForbiddenError("IAM resource resolution failed", undefined, {
            messageKey: "iam.resourceResolutionFailed",
          });
        return { action: definition.action, resources, batch: definition.resourceKind === "batch" };
      }),
    );
    if (
      resolved.reduce((count, definition) => count + definition.resources.length, 0) >
      IAM_AUTHORIZATION_LIMITS.resourcesPerRequest
    )
      throw new ForbiddenError("IAM resource capacity exceeded", undefined, {
        messageKey: "iam.resourceResolutionFailed",
      });
    const policies = await IamAuthorizationService.getInstance().loadPolicies(principal);
    const { evaluatePolicies } = await import("../evaluator/policy-evaluator");
    const context = requestConditionContext(request, principal);
    const groups = resolved.map((definition) => ({
      ...definition,
      results: definition.resources.map((resource) =>
        evaluatePolicies(policies, { action: definition.action, resource, context }),
      ),
    }));
    for (const group of groups)
      group.results.forEach((result, index) => {
        const resource = group.resources[index],
          action = group.action;
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
          ...(group.batch ? { batchSize: group.resources.length, batchIndex: index } : {}),
        });
      });
    const allowed = any
      ? groups.some((group) => group.results.every((result) => result.decision === "Allow"))
      : groups.every((group) => group.results.every((result) => result.decision === "Allow"));
    return mode === "shadow" ? legacyAllowed! : allowed;
  } catch (error) {
    // Shadow leaves legacy enforcement intact, but never degrades an enforce request to legacy.
    if (mode === "shadow") {
      logger.warn("IAM shadow evaluation failed", {
        reason: "iam-evaluation-failed",
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
