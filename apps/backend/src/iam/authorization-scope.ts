import { createHash } from "node:crypto";
export function iamAuthorizationScopeKey(type: string, resourceId?: string | null, arn?: string | null): string {
  return createHash("sha256")
    .update(JSON.stringify([type, resourceId ?? null, arn ?? null]))
    .digest("hex");
}
