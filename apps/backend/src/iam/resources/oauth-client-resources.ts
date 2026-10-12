import { buildAcsResource } from "@quyan/shared";
export function isCanonicalOAuthClientId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
export function oauthClientArn(accountId: string, userId: string, clientId: string) {
  if (![accountId, userId, clientId].every(isCanonicalOAuthClientId)) throw new Error("Invalid OAuth client identity");
  return buildAcsResource({ service: "oauth", region: "*", accountId, path: `client/${userId}/${clientId}` });
}
