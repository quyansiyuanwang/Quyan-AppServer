import { buildAcsResource } from "@quyan/shared";

/** Provider resources are parented by the authenticated user, never by request input. */
function providerResource(
  accountOwnerId: string,
  userId: string,
  type: "provider" | "provider-earning" | "provider-settlement",
  id: string,
) {
  if (![userId, id].every((value) => /^[A-Za-z0-9_-]{1,128}$/.test(value)))
    throw new Error("Invalid provider resource identifier");
  return buildAcsResource({
    service: "relay",
    region: "*",
    accountId: accountOwnerId,
    path: type + "/" + userId + "/" + id,
  });
}
export function relayProviderArn(accountOwnerId: string, userId: string, providerId: string) {
  return providerResource(accountOwnerId, userId, "provider", providerId);
}
export function relayProviderEarningArn(accountOwnerId: string, userId: string, earningId: string) {
  return providerResource(accountOwnerId, userId, "provider-earning", earningId);
}

export function relayProviderSettlementArn(accountOwnerId: string, userId: string, settlementId: string) {
  return providerResource(accountOwnerId, userId, "provider-settlement", settlementId);
}
