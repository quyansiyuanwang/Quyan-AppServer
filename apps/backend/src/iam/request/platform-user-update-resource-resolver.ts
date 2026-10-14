import type { ResourceResolver } from "./resource-resolvers";
import { PlatformUserUpdateRepository } from "@/store/users/platform-user-update.repository";
import { isPlatformUserId, platformUserArn } from "../resources/platform-user-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
export const platformUserUpdateResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const id = request.params.userId;
  if (!isPlatformUserId(id)) throw iamAccountDenied();
  const target = await PlatformUserUpdateRepository.getInstance().target(principal, id);
  if (target.resource.id !== id) throw iamAccountDenied();
  return platformUserArn(id);
};
