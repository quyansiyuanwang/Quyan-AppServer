import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
import { isRelayTokenResourceId } from "./relay-token-resources";
/** Personal requests are submitter-owned; platform requests remain under the channel's deployment scope. */
export function relayChannelChangeRequestArn(accountOwnerId: string, userId: string, id: string) {
  if (![accountOwnerId, userId, id].every(isRelayTokenResourceId)) throw new Error("Invalid change request identifier");
  return buildAcsResource({
    service: "relay",
    region: "*",
    accountId: accountOwnerId,
    path: "channel-change-request/" + userId + "/" + id,
  });
}
export function platformRelayChannelChangeRequestArn(channelId: string, id: string) {
  if (![channelId, id].every(isRelayTokenResourceId)) throw new Error("Invalid change request identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "relay-channel-change-request/" + channelId + "/" + id,
  });
}
