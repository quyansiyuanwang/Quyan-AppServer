import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { isRemoteTerminalId } from "@/iam/resources/remote-terminal-resources";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { assertIamAccountPrincipal, iamAccountDenied } from "../users/iam-account-principal";
import { BadRequestError, ConflictError } from "@/util/errors";
import type {
  TerminalPersonalUnbindStore,
  TerminalPersonalUnbindTarget,
  TerminalPersonalUnbindGuard,
} from "./terminal-personal-unbind.store";
export function terminalPersonalUnbindRevision(target: Omit<TerminalPersonalUnbindTarget, "revision">) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        Object.keys(target)
          .filter((key) => key !== "revision")
          .sort()
          .map((key) => [key, target[key as keyof typeof target]]),
      ),
    )
    .digest("hex");
}
export class TerminalPersonalUnbindRepository implements TerminalPersonalUnbindStore {
  private static instance: TerminalPersonalUnbindRepository;
  static getInstance() {
    return (this.instance ??= new TerminalPersonalUnbindRepository());
  }
  private async read(
    tx: Prisma.TransactionClient,
    principal: IamPrincipal,
    id: string,
  ): Promise<TerminalPersonalUnbindTarget | null> {
    const row = await tx.remoteTerminalDeviceBinding.findFirst({
      where: { id, userId: principal.subjectUserId, status: { in: [0, 1] } },
      select: {
        id: true,
        userId: true,
        entitlementId: true,
        hostname: true,
        status: true,
        updateTime: true,
        entitlement: { select: { userId: true, status: true, updateTime: true, unbindResetAt: true } },
      },
    });
    if (
      !row ||
      row.id !== id ||
      row.userId !== principal.subjectUserId ||
      row.entitlement.userId !== row.userId ||
      ![-1, 0, 1].includes(row.entitlement.status)
    )
      return null;
    const { hostname, entitlement, ...fields } = row;
    const target = {
      ...fields,
      label: hostname,
      unbindResetAt: entitlement.unbindResetAt,
      entitlementUpdateTime: entitlement.updateTime,
      entitlementStatus: entitlement.status,
    };
    return { ...target, revision: terminalPersonalUnbindRevision(target) };
  }
  async target(principal: IamPrincipal, id: string) {
    if (!isRemoteTerminalId(id)) throw iamAccountDenied();
    await assertIamAccountPrincipal(principal);
    return this.read(prisma, principal, id);
  }
  async run(target: TerminalPersonalUnbindTarget, guard: TerminalPersonalUnbindGuard, mutate: boolean) {
    const principal = guard.users.principal;
    if (
      mutate !== (guard.operation === "RevokeMyDeviceBinding") ||
      target.id !== guard.targetId ||
      target.entitlementId !== guard.entitlementId ||
      target.userId !== principal.subjectUserId ||
      guard.users.targetUserId !== target.userId ||
      !isRemoteTerminalId(target.id) ||
      !isRemoteTerminalId(target.entitlementId) ||
      terminalPersonalUnbindRevision(target) !== target.revision ||
      !Number.isInteger(guard.config.maxCount) ||
      guard.config.maxCount < 0 ||
      !Number.isFinite(guard.config.windowHours) ||
      guard.config.windowHours <= 0
    )
      throw iamAccountDenied();
    try {
      return await prisma.$transaction(
        async (tx) => {
          await assertIamAccountUserMutation(tx, guard.users, target.userId);
          // All personal revocations for one entitlement share this lock, including distinct bindings.
          await tx.$queryRaw`SELECT id FROM remote_terminal_user_entitlements WHERE id=${target.entitlementId} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM remote_terminal_device_bindings WHERE id=${target.id} FOR UPDATE`;
          const current = await this.read(tx, principal, target.id);
          if (!current || current.revision !== target.revision) throw iamAccountDenied();
          const windowStart = new Date(Date.now() - guard.config.windowHours * 60 * 60 * 1000);
          const windowStartAt =
            current.unbindResetAt && current.unbindResetAt > windowStart ? current.unbindResetAt : windowStart;
          // A locking read must see revocations committed while we waited for the entitlement lock.
          const [count] = await tx.$queryRaw<
            { total: bigint }[]
          >`SELECT COUNT(*) AS total FROM remote_terminal_device_bindings WHERE entitlementId=${target.entitlementId} AND status=-1 AND updateTime>=${windowStartAt} FOR UPDATE`;
          const revokedCount = Number(count?.total);
          if (!Number.isSafeInteger(revokedCount) || revokedCount < 0) throw iamAccountDenied();
          if (mutate) {
            if (guard.config.maxCount <= 0)
              throw new BadRequestError("Device unbinding is currently disabled", undefined, {
                messageKey: "remoteTerminalProduct.unbindDisabled",
              });
            if (revokedCount >= guard.config.maxCount)
              throw new BadRequestError("Device unbind limit reached", undefined, {
                messageKey: "remoteTerminalProduct.unbindLimitReached",
                messageParams: { maxCount: guard.config.maxCount, windowHours: guard.config.windowHours },
              });
            await tx.remoteTerminalDeviceBinding.update({
              where: { id: target.id },
              data: { status: -1, online: false },
            });
          }
          await assertIamAccountUserMutation(tx, guard.users, target.userId);
          return { revokedCount, windowStartAt };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        throw new ConflictError("Device unbind state changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
}
