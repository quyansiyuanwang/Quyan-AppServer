import type { ResourceResolver } from "./resource-resolvers";
import { ImpersonationIamRepository } from "@/store/users/impersonation-iam.repository";
import { isPlatformUserId, platformUserArn } from "../resources/platform-user-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
/** Target identity and qualification come from persistence, never request owner/action headers. */
export const impersonationResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const targetId = (request.body as { targetUserId?: unknown } | undefined)?.targetUserId;
  if (!isPlatformUserId(targetId) || request.user?.impersonatorId || request.oauthAccessToken) throw iamAccountDenied();
  const snapshot = await ImpersonationIamRepository.getInstance().snapshot(principal, targetId, request.accessKey?.id);
  return platformUserArn(snapshot.target.id);
};
