import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import type { IamPrincipal } from "@quyan/shared";
import { assertIamAccountPrincipal, iamAccountDenied } from "../users/iam-account-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { readTerminalDeviceTargets } from "./remote-terminal-device-read.repository";
import { assertTerminalDeviceTargets } from "./remote-terminal-device-snapshot";
import type { RemoteTerminalDeviceProbeStore, TerminalProbeGuard } from "./remote-terminal-device-probe.store";
import { ConflictError } from "@/util/errors";

export class RemoteTerminalDeviceProbeRepository implements RemoteTerminalDeviceProbeStore {
  private static instance: RemoteTerminalDeviceProbeRepository;
  static getInstance() {
    return (this.instance ??= new RemoteTerminalDeviceProbeRepository());
  }
  async revision(principal: IamPrincipal) {
    await assertIamAccountPrincipal(principal);
    return readIamAuthorizationRevision(prisma, principal.accountOwnerId);
  }
  async record(guard: TerminalProbeGuard, pongAt: Date | null) {
    if (
      !/^[a-f0-9]{64}$/.test(guard.authorizationRevision) ||
      guard.target.userId !== guard.principal.subjectUserId ||
      (pongAt !== null && (!(pongAt instanceof Date) || !Number.isFinite(pongAt.getTime())))
    )
      throw iamAccountDenied();
    try {
      return await prisma.$transaction(
        async (tx) => {
          const ids = [...new Set([guard.principal.subjectUserId, guard.principal.accountOwnerId])].sort();
          await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
          await assertIamAccountPrincipal(guard.principal, tx);
          // Serializable reads lock the current legacy group and all IAM policy/binding ranges.
          const actor = await tx.user.findUnique({
            where: { id: guard.principal.subjectUserId },
            select: { groupId: true },
          });
          if (actor?.groupId)
            await tx.group.findUnique({
              where: { id: actor.groupId },
              select: { id: true, status: true, permissions: true, accountOwnerId: true },
            });
          if ((await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId)) !== guard.authorizationRevision)
            throw iamAccountDenied();
          assertTerminalDeviceTargets(
            await readTerminalDeviceTargets(tx, guard.principal, [guard.target.deviceId], true),
            [guard.target],
            false,
          );
          await guard.recheck();
          const row = await tx.remoteTerminalDeviceBinding.update({
            where: { id: guard.target.id },
            data: { online: Boolean(pongAt), ...(pongAt ? { lastSeenAt: pongAt, lastOnlineAt: pongAt } : {}) },
            select: { deviceId: true, online: true, lastSeenAt: true },
          });
          await assertIamAccountPrincipal(guard.principal, tx);
          if ((await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId)) !== guard.authorizationRevision)
            throw iamAccountDenied();
          await guard.recheck();
          return { deviceId: row.deviceId, online: row.online, lastSeenAt: row.lastSeenAt.toISOString() };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        throw new ConflictError("Terminal device or authorization changed", undefined, {
          messageKey: "errors.conflict",
        });
      throw error;
    }
  }
}
