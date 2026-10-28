import type { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { iamAccountDenied } from "../users/iam-account-principal";
/** Lock only credential metadata; last-used counters never form a credential revision. */
export async function assertTerminalInstallCredential(
  tx: Prisma.TransactionClient,
  principal: IamPrincipal,
  accessKeyId?: string,
) {
  if ((principal.subjectType === "access_key") !== (accessKeyId !== undefined)) throw iamAccountDenied();
  if (!accessKeyId) return;
  await tx.$queryRaw`SELECT id FROM access_keys WHERE id=${accessKeyId} FOR UPDATE`;
  const key = await tx.accessKey.findFirst({
    where: {
      id: accessKeyId,
      userId: principal.subjectUserId,
      status: 1,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true, userId: true },
  });
  if (key?.id !== accessKeyId || key.userId !== principal.subjectUserId) throw iamAccountDenied();
}
