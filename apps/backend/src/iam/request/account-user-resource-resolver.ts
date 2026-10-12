import { buildAcsResource } from "@quyan/shared";
import { IamAccountUserRepository } from "@/store/users/iam-account-principal";
import type { ResourceResolver } from "./resource-resolvers";
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
