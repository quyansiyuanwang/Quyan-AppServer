import { buildAcsResource } from "@quyan/shared";
export function isCanonicalJsonEndpointId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
export function jsonEndpointArn(accountOwnerId: string, userId: string, endpointId: string) {
  if (!isCanonicalJsonEndpointId(userId) || !isCanonicalJsonEndpointId(endpointId))
    throw new Error("Invalid JSON Endpoint resource identity");
  return buildAcsResource({
    service: "json-endpoint",
    region: "*",
    accountId: accountOwnerId,
    path: "endpoint/" + userId + "/" + endpointId,
  });
}
