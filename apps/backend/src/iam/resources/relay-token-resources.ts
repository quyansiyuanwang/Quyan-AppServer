import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
export const isRelayTokenResourceId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function relayTokenArn(accountOwnerId: string, userId: string, tokenId: string) {
  if (![userId, tokenId].every(isRelayTokenResourceId)) throw new Error("Invalid relay token resource identifier");
  return buildAcsResource({
    service: "relay",
    region: "*",
    accountId: accountOwnerId,
    path: "token/" + userId + "/" + tokenId,
  });
}
export function platformRelayTokenArn(userId: string, tokenId: string) {
  if (![userId, tokenId].every(isRelayTokenResourceId))
    throw new Error("Invalid platform relay token resource identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "relay-token/" + userId + "/" + tokenId,
  });
}

export type RelayTokenReadOperation = "ListTokens" | "GetToken" | "ExportTokens";
/** Operations are server-declared; never derive the requested operation from headers/body. */
export function relayTokenReadAction(operation: RelayTokenReadOperation, managed: boolean): string {
  const managedOperations = {
    ListTokens: "ListManagedTokens",
    GetToken: "GetManagedToken",
    ExportTokens: "ExportManagedTokens",
  } as const;
  return "quyan:relay:" + (managed ? managedOperations[operation] : operation);
}
