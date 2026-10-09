import { buildAcsResource } from "@quyan/shared";
/** Article IDs are persisted CUIDs; reject aliases and ARN syntax before querying. */
export function isCanonicalArticleId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}
export function articleArn(accountOwnerId: string, id: string): string {
  if (!isCanonicalArticleId(id)) throw new Error("Invalid article resource identifier");
  return buildAcsResource({ service: "article", region: "*", accountId: accountOwnerId, path: "article/" + id });
}
