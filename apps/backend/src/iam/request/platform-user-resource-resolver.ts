import type { ResourceResolver } from "./resource-resolvers";
import { PlatformUserReadRepository, validPlatformUserTarget } from "@/store/users/platform-user-read.repository";
import { platformUserArn, isPlatformUserId } from "../resources/platform-user-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
export const platformUserResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const id = request.params.userId;
  if (!isPlatformUserId(id)) throw iamAccountDenied();
  const target = await PlatformUserReadRepository.getInstance().target(principal, id);
  if (!target || target.id !== id || !validPlatformUserTarget(target)) throw iamAccountDenied();
  return platformUserArn(target.id);
};
