import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { iamAccountDenied } from "../users/iam-account-principal";
import type { PlatformManagementReadSnapshot } from "../system/platform-management-read.store";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { ConflictError, NotFoundError } from "@/util/errors";
export interface PlatformRelayProbeAccountDeleteStore {
  remove(
    id: string,
    principal: IamPrincipal,
    snapshot: PlatformManagementReadSnapshot,
    recheck: () => Promise<void>,
    persist: boolean,
  ): Promise<void>;
}
export class PlatformRelayProbeAccountDeleteRepository implements PlatformRelayProbeAccountDeleteStore {
  private static instance: PlatformRelayProbeAccountDeleteRepository;
  static getInstance() {
    return (this.instance ??= new PlatformRelayProbeAccountDeleteRepository());
  }
  async remove(
    id: string,
    principal: IamPrincipal,
    snapshot: PlatformManagementReadSnapshot,
    recheck: () => Promise<void>,
    persist: boolean,
  ) {
    try {
      await prisma.$transaction(
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
          await tx.$queryRaw(Prisma.sql`SELECT id FROM relay_channel_probe_accounts WHERE id = ${id} FOR UPDATE`);
          const account = await tx.relayChannelProbeAccount.findUnique({ where: { id }, select: { id: true } });
          if (!account)
            throw new NotFoundError("Probe account not found", undefined, {
              messageKey: "relayChannelProbe.accountNotFound",
            });
          if (await tx.relayChannelProbeTargetConfig.count({ where: { accountId: id } }))
            throw new ConflictError("Account is still bound", undefined, {
              messageKey: "relayChannelProbe.accountStillBound",
            });
          await recheck();
          if (persist) {
            const deleted = await tx.relayChannelProbeAccount.deleteMany({ where: { id } });
            if (deleted.count !== 1) throw iamAccountDenied();
          }
          await identity();
          await recheck();
          if ((await readIamAuthorizationRevision(tx, principal.accountOwnerId)) !== revision) throw iamAccountDenied();
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2003", "P2034"].includes(error.code))
        throw new ConflictError("Probe account context changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
}
