import { buildAcsResource } from "@quyan/shared";
export function isCanonicalOjApiKeyId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
export function ojApiKeyArn(accountOwnerId: string, userId: string, id: string) {
  if (!isCanonicalOjApiKeyId(userId) || !isCanonicalOjApiKeyId(id)) throw new Error("Invalid OJ API Key identity");
  return buildAcsResource({
    service: "oj",
    region: "*",
    accountId: accountOwnerId,
    path: "api-key/" + userId + "/" + id,
  });
}
