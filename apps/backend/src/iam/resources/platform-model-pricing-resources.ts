import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
export function isModelPricingRecordId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}
export function platformModelPricingArn(id: string) {
  if (!isModelPricingRecordId(id)) throw new Error("Invalid model pricing record identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "model-pricing/" + id,
  });
}

export function platformModelPricingCollectionArn() {
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "model-pricing-control/default",
  });
}
