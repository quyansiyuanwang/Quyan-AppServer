import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
import { isPlatformLogResourceId } from "./platform-log-resources";
/** Global relay channels are deployment resources, independent of an account's identity ARN. */
export function platformRelayChannelArn(id: string) {
  if (!isPlatformLogResourceId(id)) throw new Error("Invalid platform relay channel identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "relay-channel/" + id,
  });
}
