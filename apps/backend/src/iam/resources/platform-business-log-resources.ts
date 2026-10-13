import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
import { isPlatformLogResourceId } from "./platform-log-resources";
export function platformBusinessLogArn(id: string): string {
  if (!isPlatformLogResourceId(id)) throw new Error("Invalid business log identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "business-log/" + id,
  });
}
