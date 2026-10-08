import { IAM_AUTHORIZATION_LIMITS } from "../authorization-limits";
import { buildAcsResource } from "@quyan/shared";
import type { IamPrincipal } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
export interface ResourceResolverContext {
  request: TypedRequest<unknown>;
  principal: IamPrincipal;
}
export type ResourceResolver = (context: ResourceResolverContext) => string | undefined | Promise<string | undefined>;
export type BatchResourceResolver = (
  context: ResourceResolverContext,
) => readonly string[] | undefined | Promise<readonly string[] | undefined>;
export const ramAccountResourceResolver: ResourceResolver = ({ principal }) =>
  buildAcsResource({ service: "quyan", region: "*", accountId: principal.accountOwnerId, path: "account" });
/** Resolver factories require already-validated, server-owned identifiers. Ownership checks remain in services. */
export function accountEntityResourceResolver(
  kind: "user" | "group" | "role" | "policy" | "authorization" | "resource-group" | "role-session" | "relay-channel",
  readId: (request: TypedRequest<unknown>) => unknown,
): ResourceResolver {
  return ({ request, principal }) => {
    const id = readId(request);
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return undefined;
    return buildAcsResource({
      service: kind === "relay-channel" ? "relay" : "quyan",
      region: "*",
      accountId: principal.accountOwnerId,
      path: (kind === "relay-channel" ? "channel" : kind) + "/" + id,
    });
  };
}

/** Reject the entire batch when any identifier is invalid; never omit an unresolved target. */
export function accountEntityBatchResourceResolver(
  kind: "user" | "group" | "role" | "policy" | "authorization" | "resource-group" | "role-session" | "relay-channel",
  readIds: (request: TypedRequest<unknown>) => unknown,
): BatchResourceResolver {
  return ({ request, principal }) => {
    const ids = readIds(request);
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      Array.from(ids).some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
    )
      return undefined;
    return ids.map((id) =>
      buildAcsResource({
        service: kind === "relay-channel" ? "relay" : "quyan",
        region: "*",
        accountId: principal.accountOwnerId,
        path: (kind === "relay-channel" ? "channel" : kind) + "/" + id,
      }),
    );
  };
}

export const ramAuthorizationResourceResolver = accountEntityResourceResolver(
  "authorization",
  (request) => request.params.authorizationId,
);
export const ramResourceGroupResourceResolver = accountEntityResourceResolver(
  "resource-group",
  (request) => request.params.groupId,
);
