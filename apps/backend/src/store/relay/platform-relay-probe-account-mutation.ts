import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { iamAccountDenied } from "../users/iam-account-principal";
import type { PlatformManagementReadSnapshot } from "../system/platform-management-read.store";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { ConflictError } from "@/util/errors";
/** Lock platform membership and authorization ranges around a probe-account mutation. */
export async function mutatePlatformRelayProbeAccount<T>(
  principal: IamPrincipal,
  snapshot: PlatformManagementReadSnapshot,
  recheck: () => Promise<void>,
  mutate: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const identity = async () => {
          await assertIamAccountUserMutation(
            tx,
            { principal, targetUserId: principal.subjectUserId, users: snapshot.users, recheck },
            principal.subjectUserId,
          );
          await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id = ${snapshot.group.id} FOR UPDATE`);
          const group = await platformManagementGroupSnapshot(
            principal,
            Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE,
            tx,
          );
          if (group.id !== snapshot.group.id || group.updateTime.getTime() !== snapshot.group.updateTime.getTime())
            throw iamAccountDenied();
        };
        await identity();
        const revision = await readIamAuthorizationRevision(tx, principal.accountOwnerId);
        const result = await mutate(tx);
        await identity();
        await recheck();
        if ((await readIamAuthorizationRevision(tx, principal.accountOwnerId)) !== revision) throw iamAccountDenied();
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2003", "P2034"].includes(error.code))
      throw new ConflictError("Probe account context changed", undefined, { messageKey: "errors.conflict" });
    throw error;
  }
}
