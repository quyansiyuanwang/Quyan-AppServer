import { buildAcsResource } from "@quyan/shared";

export function isCanonicalScriptId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

export function userScriptArn(accountOwnerId: string, userId: string, scriptId: string): string {
  if (!isCanonicalScriptId(userId) || !isCanonicalScriptId(scriptId))
    throw new Error("Invalid script resource identifier");
  return buildAcsResource({
    service: "script",
    region: "*",
    accountId: accountOwnerId,
    path: "script/" + userId + "/" + scriptId,
  });
}
