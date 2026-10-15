import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
import { isPlatformLogResourceId } from "./platform-log-resources";
export function platformRelayProbeAccountArn(id: string) {
  if (!isPlatformLogResourceId(id)) throw new Error("Invalid platform probe account identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "relay-probe-account/" + id,
  });
}
