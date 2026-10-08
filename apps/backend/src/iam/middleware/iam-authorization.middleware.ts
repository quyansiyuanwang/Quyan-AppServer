import { performance } from "node:perf_hooks";
import type { RequestHandler } from "express";
import { isKnownIamAction, isValidIamResource, IAM_RESOURCE_KINDS } from "@quyan/shared";
import { IamAuthorizationService } from "../iam-authorization.service";
import { getIamPrincipal } from "../request/principal-context";
import type { IamAuthorizationDefinition } from "../request/authorization-definition";
import { auditIamDecision } from "../audit/iam-audit.service";
import { UnauthorizedError, ForbiddenError } from "@/util/errors";
import type { TypedRequest } from "@/types/express";
/** Explicit IAM endpoints always enforce; rollout modes apply only to legacy bridges. */
export function iamAuthorizationMiddleware(
  definition: IamAuthorizationDefinition,
  service = IamAuthorizationService.getInstance(),
): RequestHandler {
  if (!IAM_RESOURCE_KINDS.includes(definition.resourceKind) || typeof definition.resource !== "function")
    throw new Error("IAM endpoint requires a resource kind and server resolver");
  if (!isKnownIamAction(definition.action)) throw new Error("IAM endpoint action is absent from catalog");
  return async (req, _res, next) => {
    try {
      const request = req as TypedRequest,
        principal = getIamPrincipal(request);
      if (!principal)
        throw new UnauthorizedError("IAM principal missing", undefined, { messageKey: "permission.loginRequired" });
      const resource = await definition.resource({ request, principal });
      if (!resource || !isValidIamResource(resource))
        throw new ForbiddenError("IAM resource resolution failed", undefined, {
          messageKey: "iam.resourceResolutionFailed",
        });
      const start = performance.now();
      const result = await service.authorize({ principal, action: definition.action, resource });
      (request.iamDecisions ??= []).push({ ...result, action: definition.action, resource });
      auditIamDecision({
        requestId: request.res?.locals.requestId,
        principal,
        action: definition.action,
        resource,
        result,
        evaluationLatencyMs: performance.now() - start,
        authorizationMode: "enforce",
      });
      if (result.decision !== "Allow")
        throw new ForbiddenError("IAM policy denied request", undefined, {
          messageKey: "permission.insufficientPermission",
        });
      next();
    } catch (error) {
      next(error);
    }
  };
}
