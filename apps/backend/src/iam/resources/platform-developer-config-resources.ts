import {
  buildAcsResource,
  IAM_PLATFORM_ACCOUNT_ID,
  isDeveloperProductCode,
  type DeveloperProductCode,
} from "@quyan/shared";
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
export function platformDeveloperConfigControlArn(product: DeveloperProductCode) {
  if (!isDeveloperProductCode(product)) throw new Error("Invalid developer product code");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "developer-product-config-control/" + product,
  });
}
