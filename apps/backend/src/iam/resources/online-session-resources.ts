import { type IamPrincipal, buildAcsResource } from "@quyan/shared";
export function isCanonicalOnlineId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
export function onlineSessionArn(accountOwnerId: string, userId: string, id: string) {
  if (!isCanonicalOnlineId(userId) || !isCanonicalOnlineId(id)) throw new Error("Invalid online session identity");
  return buildAcsResource({
    service: "quyan",
    region: "*",
    accountId: accountOwnerId,
    path: "online-session/" + userId + "/" + id,
  });
}
export function onlineUserArn(accountOwnerId: string, userId: string) {
  if (!isCanonicalOnlineId(userId)) throw new Error("Invalid online user identity");
  return buildAcsResource({ service: "quyan", region: "*", accountId: accountOwnerId, path: "user/" + userId });
}

/** Delegated monitor access cannot remove the account owner recovery session. */
export function canRevokeOnlineUser(principal: IamPrincipal, userId: string) {
  return userId !== principal.accountOwnerId || principal.subjectUserId === principal.accountOwnerId;
}
