import { buildAcsResource } from "@quyan/shared";
import { passkeyCredentialIdParamsSchema } from "@/api/schema/users/passkey.schema";
export function isCanonicalPasskeyResourceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
/** ARN uses the persisted record identity, never untrusted authenticator data. */
export function passkeyArn(accountOwnerId: string, userId: string, passkeyId: string) {
  if (!isCanonicalPasskeyResourceId(userId) || !isCanonicalPasskeyResourceId(passkeyId))
    throw new Error("Invalid Passkey resource identity");
  return buildAcsResource({
    service: "quyan",
    region: "*",
    accountId: accountOwnerId,
    path: "passkey/" + userId + "/" + passkeyId,
  });
}

export function isCanonicalPasskeyCredentialId(value: unknown): value is string {
  const parsed = passkeyCredentialIdParamsSchema.safeParse({ credentialId: value });
  return parsed.success && parsed.data.credentialId === value;
}
