import { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { iamAccountDenied } from "./iam-account-principal";
/** A non-secret revision for asynchronous authority; usage counters do not revoke queued work. */
export async function captureIamAccessKeyRevision(
  principal: IamPrincipal,
  accessKeyId?: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<string | undefined> {
  if (!accessKeyId) {
    if (principal.subjectType === "access_key") throw iamAccountDenied();
    return undefined;
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(accessKeyId)) throw iamAccountDenied();
  const keys = await tx.$queryRaw<{ id: string; revision: string }[]>(Prisma.sql`
    SELECT k.id,SHA2(CAST(JSON_ARRAY(k.id,k.userId,k.status,k.key,k.legacyKey,k.expiresAt) AS CHAR),256) AS revision
    FROM access_keys k WHERE BINARY k.id=BINARY ${accessKeyId} AND BINARY k.userId=BINARY ${principal.subjectUserId}
      AND k.status=1 AND (k.expiresAt IS NULL OR k.expiresAt>${new Date()})`);
  if (keys.length !== 1 || keys[0].id !== accessKeyId || !/^[a-f0-9]{64}$/.test(keys[0].revision))
    throw iamAccountDenied();
  return keys[0].revision;
}
