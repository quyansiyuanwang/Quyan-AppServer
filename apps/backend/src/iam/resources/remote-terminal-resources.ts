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
