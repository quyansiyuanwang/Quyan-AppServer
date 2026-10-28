import { buildAcsResource } from "@quyan/shared";
export function isRelayModelCatalogId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}
/** Account-scoped public discovery projection, not the platform pricing-management resource. */
export function relayModelCatalogArn(accountOwnerId: string, modelRecordId: string) {
  if (!isRelayModelCatalogId(accountOwnerId) || !isRelayModelCatalogId(modelRecordId))
    throw new Error("Invalid model catalog identity");
  return buildAcsResource({
    service: "relay",
    region: "*",
    accountId: accountOwnerId,
    path: "model-catalog-entry/" + modelRecordId,
  });
}
