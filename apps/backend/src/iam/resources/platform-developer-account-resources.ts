import {
  buildAcsResource,
  IAM_PLATFORM_ACCOUNT_ID,
  isDeveloperProductCode,
  type DeveloperProductCode,
} from "@quyan/shared";
export function isDeveloperAccountRecordId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}
export function platformDeveloperAccountArn(id: string) {
  if (!isDeveloperAccountRecordId(id)) throw new Error("Invalid developer product account record identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "developer-product-account/" + id,
  });
}
export function platformDeveloperAccountScopeArn(ownerId: string, product: DeveloperProductCode) {
  if (!isDeveloperAccountRecordId(ownerId) || !isDeveloperProductCode(product))
    throw new Error("Invalid product account scope");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "developer-product-account-scope/" + ownerId + "/" + product,
  });
}
