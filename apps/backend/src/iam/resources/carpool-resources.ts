import { buildAcsResource } from "@quyan/shared";

export function isCanonicalCarpoolId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,50}$/.test(value);
}
export function carpoolArn(accountOwnerId: string, type: "order" | "template", id: string): string {
  if (!isCanonicalCarpoolId(id)) throw new Error("Invalid carpool resource identifier");
  return buildAcsResource({ service: "carpool", region: "*", accountId: accountOwnerId, path: type + "/" + id });
}
