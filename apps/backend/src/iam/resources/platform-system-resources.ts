import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
export type PlatformSystemResource = "build-info" | "stats" | "consumption-stats";
const resources: readonly PlatformSystemResource[] = ["build-info", "stats", "consumption-stats"];
export function platformSystemArn(resource: PlatformSystemResource) {
  if (!resources.includes(resource)) throw new Error("Unregistered system information resource");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "system/" + resource,
  });
}
