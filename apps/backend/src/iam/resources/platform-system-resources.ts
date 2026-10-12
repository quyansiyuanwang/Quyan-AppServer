import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
const resources = [
  "build-info",
  "stats",
  "consumption-stats",
  "tracking-stats",
  "tracking-funnel",
  "heatmap-stats",
  "openapi-spec",
] as const;
export type PlatformSystemResource = (typeof resources)[number];
export function platformSystemArn(resource: PlatformSystemResource) {
  if (!resources.includes(resource)) throw new Error("Unregistered system information resource");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "system/" + resource,
  });
}
