import { buildAcsResource } from "@quyan/shared";

export function isRemoteTerminalId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
/** Account and device owner come from authenticated and persisted identity, never request fields. */
export function remoteTerminalDeviceArn(accountOwnerId: string, userId: string, deviceId: string): string {
  if (!isRemoteTerminalId(userId) || !isRemoteTerminalId(deviceId)) throw new Error("Invalid terminal resource ID");
  return buildAcsResource({
    service: "remote-terminal",
    region: "*",
    accountId: accountOwnerId,
    path: "device/" + userId + "/" + deviceId,
  });
}

export function remoteTerminalSessionArn(accountOwnerId: string, userId: string, sessionId: string): string {
  if (!isRemoteTerminalId(userId) || !isRemoteTerminalId(sessionId)) throw new Error("Invalid terminal resource ID");
  return buildAcsResource({
    service: "remote-terminal",
    region: "*",
    accountId: accountOwnerId,
    path: "session/" + userId + "/" + sessionId,
  });
}

function productResource(
  accountOwnerId: string,
  userId: string,
  id: string,
  type: "product-binding" | "product-entitlement" | "published-template",
) {
  if (!isRemoteTerminalId(userId) || !isRemoteTerminalId(id)) throw new Error("Invalid terminal product resource ID");
  return buildAcsResource({
    service: "remote-terminal",
    region: "*",
    accountId: accountOwnerId,
    path: type + "/" + userId + "/" + id,
  });
}
export const remoteTerminalProductBindingArn = (accountOwnerId: string, userId: string, id: string) =>
  productResource(accountOwnerId, userId, id, "product-binding");
export const remoteTerminalProductEntitlementArn = (accountOwnerId: string, userId: string, id: string) =>
  productResource(accountOwnerId, userId, id, "product-entitlement");

export function remoteTerminalProductRegistrationTokenArn(
  accountOwnerId: string,
  userId: string,
  entitlementId: string,
  tokenId: string,
) {
  if (![userId, entitlementId, tokenId].every(isRemoteTerminalId))
    throw new Error("Invalid terminal registration resource ID");
  return buildAcsResource({
    service: "remote-terminal",
    region: "*",
    accountId: accountOwnerId,
    path: "product-registration-token/" + userId + "/" + entitlementId + "/" + tokenId,
  });
}

export const remoteTerminalPublishedTemplateArn = (accountOwnerId: string, userId: string, id: string) =>
  productResource(accountOwnerId, userId, id, "published-template");
