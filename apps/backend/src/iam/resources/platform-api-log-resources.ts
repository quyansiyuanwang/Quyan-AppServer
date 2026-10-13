import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
import { isPlatformLogResourceId as isApiLogResourceId } from "./platform-log-resources";
export { isApiLogResourceId };
export function platformApiLogArn(id: string): string {
  if (!isApiLogResourceId(id)) throw new Error("Invalid API log identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "api-request-log/" + id,
  });
}
