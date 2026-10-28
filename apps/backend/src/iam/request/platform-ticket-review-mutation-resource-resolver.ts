import type { ResourceResolver } from "./resource-resolvers";
import { PlatformTicketReviewMutationRepository } from "@/store/ticket/platform-ticket-review-mutation.repository";
import { validTicketReviewTarget } from "@/store/ticket/ticket-review-snapshot";
import { platformTicketReviewArn } from "../resources/platform-ticket-review-resources";
import { isCanonicalTicketId } from "../resources/ticket-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
export const platformTicketReviewMutationResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const id = request.params.id;
  if (!isCanonicalTicketId(id)) throw iamAccountDenied();
  const target = await PlatformTicketReviewMutationRepository.getInstance().target(principal, id);
  if (!target || target.id !== id || !validTicketReviewTarget(target)) throw iamAccountDenied();
  return platformTicketReviewArn(target.userId, target.id);
};
