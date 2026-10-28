import { buildAcsResource } from "@quyan/shared";
import { isRelayTokenResourceId } from "./relay-token-resources";
/** Business channel selection in the actor's account, not platform channel management or credential access. */
export function relayChannelSelectionArn(accountOwnerId: string, channelId: string) {
  if (![accountOwnerId, channelId].every(isRelayTokenResourceId)) throw new Error("Invalid channel selection resource");
  return buildAcsResource({
    service: "relay",
    region: "*",
    accountId: accountOwnerId,
    path: "channel-selection/" + channelId,
  });
}
