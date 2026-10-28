import type { ResourceResolver } from "./resource-resolvers";
import { PlatformUserDeleteRepository } from "@/store/users/platform-user-delete.repository";
import { isPlatformUserId, platformUserArn } from "../resources/platform-user-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
export const platformUserDeleteResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const id = request.params.userId;
  if (!isPlatformUserId(id)) throw iamAccountDenied();
  const target = await PlatformUserDeleteRepository.getInstance().target(principal, id);
  if (target.resource.id !== id) throw iamAccountDenied();
  return platformUserArn(id);
};
