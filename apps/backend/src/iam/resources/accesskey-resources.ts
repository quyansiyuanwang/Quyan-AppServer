import { buildAcsResource } from "@quyan/shared";
import { accesskeyIdParamsSchema } from "@/api/schema/users/accesskey.schema";
export function isCanonicalAccessKeyId(id: unknown): id is string {
  const parsed = accesskeyIdParamsSchema.safeParse({ id });
  return parsed.success && parsed.data.id === id;
}
export function accessKeyArn(accountOwnerId: string, userId: string, keyId: string) {
  if (!isCanonicalAccessKeyId(userId) || !isCanonicalAccessKeyId(keyId))
    throw new Error("Invalid access key resource identifier");
  return buildAcsResource({
    service: "quyan",
    region: "*",
    accountId: accountOwnerId,
    path: "access-key/" + userId + "/" + keyId,
  });
}
