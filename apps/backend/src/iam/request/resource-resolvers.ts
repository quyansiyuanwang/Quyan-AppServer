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

export const ramRoleResourceResolver = accountEntityResourceResolver("role", (request) => request.params.roleId);
export const ramAssumeRoleResourceResolver = accountEntityResourceResolver(
  "role",
  (request) => (request.body as { roleId?: unknown })?.roleId,
);

export const ramUserResourceResolver = accountEntityResourceResolver("user", (request) => request.params.userId);
export const ramEffectivePermissionsUserResourceResolver = accountEntityResourceResolver(
  "user",
  (request) => request.query.userId,
);
export const ramPolicyResourceResolver = accountEntityResourceResolver("policy", (request) => request.params.policyId);
export const ramSessionResourceResolver = accountEntityResourceResolver(
  "role-session",
  (request) => request.params.sessionId,
);

/** Every participating entity must be authorized; resolving one half never permits a binding. */
function resolveEntityPair(context: ResourceResolverContext, first: ResourceResolver, second: ResourceResolver) {
  return Promise.all([first(context), second(context)]).then((resources) =>
    resources.every((resource): resource is string => typeof resource === "string") ? resources : undefined,
  );
}
const bindingTargetResolver: ResourceResolver = (context) => {
  const { targetType, targetId } = (context.request.body ?? {}) as { targetType?: unknown; targetId?: unknown };
  if (targetType !== "user" && targetType !== "group" && targetType !== "role") return undefined;
  return accountEntityResourceResolver(targetType, () => targetId)(context);
};
export const ramPolicyBindingResourceResolver: BatchResourceResolver = (context) =>
  resolveEntityPair(
    context,
    accountEntityResourceResolver("policy", (request) => (request.body as { policyId?: unknown })?.policyId),
    bindingTargetResolver,
  );
export const ramRoleUserBindingResourceResolver: BatchResourceResolver = (context) =>
  resolveEntityPair(
    context,
    ramRoleResourceResolver,
    accountEntityResourceResolver(
      "user",
      (request) => request.params.userId ?? (request.body as { userId?: unknown })?.userId,
    ),
  );
export const ramRoleGroupBindingResourceResolver: BatchResourceResolver = (context) =>
  resolveEntityPair(
    context,
    ramRoleResourceResolver,
    accountEntityResourceResolver(
      "group",
      (request) => request.params.groupId ?? (request.body as { groupId?: unknown })?.groupId,
    ),
  );
export const ramDefaultPolicyVersionResourceResolver: BatchResourceResolver = async (context) => {
  const policy = await ramPolicyResourceResolver(context);
  const version = (context.request.body as { versionId?: unknown })?.versionId;
  if (!policy || typeof version !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(version)) return undefined;
  return [
    policy,
    buildAcsResource({
      service: "quyan",
      region: "*",
      accountId: context.principal.accountOwnerId,
      path: "policy-version/" + context.request.params.policyId + "/" + version,
    }),
  ];
};

/** A group reassignment changes both the user and group; both targets must be granted. */
const optionalUserGroupResources = async (context: ResourceResolverContext, user: ResourceResolver) => {
  const target = await user(context);
  if (!target) return undefined;
  const groupId = (context.request.body as { groupId?: unknown })?.groupId;
  if (groupId === undefined) return [target];
  const group = await accountEntityResourceResolver("group", () => groupId)(context);
  return group ? [target, group] : undefined;
};
export const ramUserUpdateResourceResolver: BatchResourceResolver = (context) =>
  optionalUserGroupResources(context, ramUserResourceResolver);
export const ramUserCreateResourceResolver: BatchResourceResolver = (context) =>
  optionalUserGroupResources(context, ramAccountResourceResolver);
