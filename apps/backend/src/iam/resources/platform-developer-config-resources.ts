import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
export function isDeveloperConfigRecordId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}
export function platformDeveloperConfigArn(id: string) {
  if (!isDeveloperConfigRecordId(id)) throw new Error("Invalid developer product configuration record identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "developer-product-config/" + id,
  });
}
