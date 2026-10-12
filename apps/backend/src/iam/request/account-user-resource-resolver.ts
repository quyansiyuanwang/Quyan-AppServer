import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { buildAcsResource } from "@quyan/shared";
import { IamAccountUserRepository } from "@/store/users/iam-account-principal";
import type { ResourceResolver, BatchResourceResolver } from "./resource-resolvers";
export const iamAccountUserResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const id = request.params.userId;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return undefined;
  const target = await IamAccountUserRepository.getInstance().target(principal, id);
  return target?.id === id
    ? buildAcsResource({
        service: "quyan",
        region: "*",
        accountId: principal.accountOwnerId,
        path: "user/" + target.id,
      })
    : undefined;
};

export const iamAccountUsersResourceResolver: BatchResourceResolver = async ({ request, principal }) => {
  const ids = (request.body as { userIds?: unknown } | undefined)?.userIds;
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
    Array.from(ids).some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
  )
    return undefined;
  const unique = [...new Set(ids)] as string[],
    targets = await IamAccountUserRepository.getInstance().targets(principal, unique);
  if (
    targets.length !== unique.length ||
    new Set(targets.map((t) => t.id)).size !== unique.length ||
    targets.some((t) => !unique.includes(t.id))
  )
    return undefined;
  return unique.map((id) =>
    buildAcsResource({ service: "quyan", region: "*", accountId: principal.accountOwnerId, path: "user/" + id }),
  );
};
