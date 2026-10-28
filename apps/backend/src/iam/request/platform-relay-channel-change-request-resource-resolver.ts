import { Permission } from "@quyan/shared";
import { platformManagementGroupSnapshot } from "@/store/users/platform-management-principal";
import { RelayChannelChangeRequestReviewRepository } from "@/store/relay/relay-channel-change-request-review.repository";
import { platformRelayChannelChangeRequestArn } from "../resources/relay-channel-change-request-resources";
import { isPlatformLogResourceId } from "../resources/platform-log-resources";
import type { ResourceResolver } from "./resource-resolvers";
/** The route carries only a proposal ID. Resolve its narrow, server-owned channel link after platform eligibility. */
export const platformRelayChannelChangeRequestReviewResourceResolver: ResourceResolver = async ({
  request,
  principal,
}) => {
  const id = request.params.id;
  if (!isPlatformLogResourceId(id)) return undefined;
  await platformManagementGroupSnapshot(principal, Permission.RELAY_CHANNEL_REVIEW);
  const link = await RelayChannelChangeRequestReviewRepository.getInstance().link(id);
  return platformRelayChannelChangeRequestArn(link.relayChannelId, link.id);
};
