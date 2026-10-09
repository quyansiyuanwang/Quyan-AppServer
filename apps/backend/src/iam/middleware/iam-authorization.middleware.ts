import { env } from "@/config/env";
import { getLogger, LogCategory } from "@/util/logger";
import { isSafeIamResourceBatch } from "../authorization-limits";
import { isValidIamResource, isIamResourceInAccount } from "@quyan/shared";
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
  return createIamAuthorizationMiddleware(definition, service, "enforce");
}

/** Rollout bridge for existing authenticated-only endpoints; legacy business guards still run. */
export function iamAuthenticatedAuthorizationMiddleware(
  definition: IamAuthorizationDefinition,
  service = IamAuthorizationService.getInstance(),
): RequestHandler {
  assertIamAuthorizationDefinition(definition);
  return (req, res, next) => {
    const mode = env.security.iamAuthorizationMode;
    if (mode === "legacy") return next();
    const middleware = createIamAuthorizationMiddleware(definition, service, mode);
    return middleware(req, res, (error?: unknown) => {
      if (mode === "shadow") {
        if (error)
          getLogger("IamAuthenticatedBridge", LogCategory.SECURITY).warn("IAM shadow evaluation denied", {
            action: definition.action,
            reason: "iam-evaluation-denied-or-unavailable",
          });
        return next();
      }
      next(error);
    });
  };
}

/** Collection access returns only individually authorized rows, including an empty page.
 * The declared resource identifies the trusted collection boundary, not a blanket Allow.
 * The service must apply database account isolation, pagination and per-row evaluation.
 */
export function iamCollectionAuthorizationMiddleware(
  definition: IamAuthorizationDefinition & { resourceKind: "collection" },
  service = IamAuthorizationService.getInstance(),
): RequestHandler {
  assertIamAuthorizationDefinition(definition);
  if (definition.resourceKind !== "collection") throw new Error("Collection middleware requires collection metadata");
  return async (req, _res, next) => {
    const mode = env.security.iamAuthorizationMode;
    if (mode === "legacy") return next();
    try {
      const request = req as TypedRequest,
        principal = getIamPrincipal(request);
      if (!principal)
        throw new UnauthorizedError("IAM collection principal missing", undefined, {
          messageKey: "permission.loginRequired",
        });
      const boundary = await definition.resource({ request, principal });
      if (
        typeof boundary !== "string" ||
        boundary === "*" ||
        !isValidIamResource(boundary) ||
        !isIamResourceInAccount(boundary, principal.accountOwnerId)
      )
        throw new ForbiddenError("IAM collection boundary unresolved", undefined, {
          messageKey: "iam.resourceResolutionFailed",
        });
      // Validate current identity/session and policy documents before the collection handler runs.
      await service.loadPolicies(principal);
      next();
    } catch (error) {
      if (mode === "shadow") {
        getLogger("IamCollectionBridge", LogCategory.SECURITY).warn("IAM collection shadow evaluation failed", {
          action: definition.action,
          reason: "iam-collection-unavailable",
        });
        return next();
      }
      next(error);
    }
  };
}

function createIamAuthorizationMiddleware(
  definition: IamAuthorizationDefinition,
  service: IamAuthorizationService,
  mode: "enforce" | "shadow",
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
          authorizationMode: mode,
          ...(mode === "shadow" ? { legacyAllowed: true } : {}),
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
