import { buildAcsResource } from "@quyan/shared";
import { isRelayTokenResourceId } from "./relay-token-resources";
/** A provider submission is owned by its submitter; it is not platform management authority. */
export function relayChannelSubmissionArn(accountOwnerId: string, userId: string, channelId: string) {
  if (![accountOwnerId, userId, channelId].every(isRelayTokenResourceId))
    throw new Error("Invalid channel submission identifier");
  return buildAcsResource({
    service: "relay",
    region: "*",
    accountId: accountOwnerId,
    path: "channel-submission/" + userId + "/" + channelId,
  });
}
