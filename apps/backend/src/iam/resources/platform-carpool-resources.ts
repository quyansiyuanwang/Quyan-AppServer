import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
import { isPlatformLogResourceId } from "./platform-log-resources";
export function platformCarpoolOrderArn(id: string) {
  if (!isPlatformLogResourceId(id)) throw new Error("Invalid carpool order identity");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "carpool-order/" + id,
  });
}
