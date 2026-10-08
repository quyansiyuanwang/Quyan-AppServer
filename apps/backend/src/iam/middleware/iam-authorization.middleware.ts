import { isSafeIamResourceBatch } from "../authorization-limits";
import { performance } from "node:perf_hooks";
import type { RequestHandler } from "express";
import { IamAuthorizationService } from "../iam-authorization.service";
import { requestConditionContext } from "../request/condition-context";
import { getIamPrincipal } from "../request/principal-context";
import { assertIamAuthorizationDefinition } from "../request/authorization-definition";
import type { IamAuthorizationDefinition } from "../request/authorization-definition";
import { auditIamDecision } from "../audit/iam-audit.service";
import { UnauthorizedError, ForbiddenError } from "@/util/errors";
import type { TypedRequest } from "@/types/express";
/** Explicit IAM endpoints always enforce; rollout modes apply only to legacy bridges. */
export function iamAuthorizationMiddleware(
  definition: IamAuthorizationDefinition,
  service = IamAuthorizationService.getInstance(),
): RequestHandler {
  assertIamAuthorizationDefinition(definition);
  return async (req, _res, next) => {
    try {
      const request = req as TypedRequest,
        principal = getIamPrincipal(request);
      if (!principal)
        throw new UnauthorizedError("IAM principal missing", undefined, { messageKey: "permission.loginRequired" });
      const resolved = await definition.resource({ request, principal });
      const resources = definition.resourceKind === "batch" ? resolved : [resolved];
      if (!isSafeIamResourceBatch(resources))
        throw new ForbiddenError("IAM resource resolution failed", undefined, {
          messageKey: "iam.resourceResolutionFailed",
        });
      const context = requestConditionContext(request, principal);
      const start = performance.now();
      const results =
        definition.resourceKind === "batch"
          ? await service.authorizeMany({ principal, action: definition.action, resources, context })
          : [await service.authorize({ principal, action: definition.action, resource: resources[0], context })];
      if (results.length !== resources.length || resources.some((_, index) => !results[index]))
        throw new ForbiddenError("Incomplete IAM batch decision", undefined, {
          messageKey: "permission.insufficientPermission",
        });
      const evaluationLatencyMs = performance.now() - start;
      results.forEach((result, index) => {
        const resource = resources[index];
        (request.iamDecisions ??= []).push({ ...result, action: definition.action, resource });
        auditIamDecision({
          requestId: request.res?.locals.requestId,
          principal,
          action: definition.action,
          resource,
          result,
          evaluationLatencyMs,
          authorizationMode: "enforce",
          ...(definition.resourceKind === "batch" ? { batchSize: resources.length, batchIndex: index } : {}),
        });
      });
      if (results.some((result) => result.decision !== "Allow"))
        throw new ForbiddenError("IAM policy denied request", undefined, {
          messageKey: "permission.insufficientPermission",
        });
      next();
    } catch (error) {
      next(error);
    }
  };
}
