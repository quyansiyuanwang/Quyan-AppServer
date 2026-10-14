import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { iamAccountDenied } from "../users/iam-account-principal";
import { BadRequestError, ConflictError } from "@/util/errors";
import type {
  PlatformTerminalEntitlementUpdateStore,
  TerminalEntitlementUpdateTarget,
  TerminalEntitlementUpdateGuard,
} from "./platform-terminal-entitlement-update.store";
export function terminalEntitlementUpdateRevision(target: Omit<TerminalEntitlementUpdateTarget, "revision">) {
  return createHash("sha256")
    .update(JSON.stringify([target.record, [...target.deviceIds].sort(), target.user]))
    .digest("hex");
}
export class PlatformTerminalEntitlementUpdateRepository implements PlatformTerminalEntitlementUpdateStore {
  private static instance: PlatformTerminalEntitlementUpdateRepository;
  static getInstance() {
    return (this.instance ??= new PlatformTerminalEntitlementUpdateRepository());
  }
  private async read(tx: Prisma.TransactionClient, id: string): Promise<TerminalEntitlementUpdateTarget | null> {
    // Only entitlement scalars and quota contributors; never hydrate credentials, snapshots or device secrets.
    const record = await tx.remoteTerminalUserEntitlement.findFirst({ where: { id, status: { in: [0, 1] } } });
    if (!record) return null;
    const user = await tx.user.findFirst({
      where: { id: record.userId, status: 1 },
      select: { id: true, status: true, accountOwnerId: true, updateTime: true },
    });
    if (!user) return null;
    const devices = await tx.remoteTerminalDeviceBinding.findMany({
      where: { entitlementId: id, status: { in: [0, 1] } },
      select: { id: true },
    });
    const target = { record, user, deviceIds: devices.map((row) => row.id) };
    return { ...target, revision: terminalEntitlementUpdateRevision(target) };
  }
  async target(principal: IamPrincipal, id: string) {
    if (!isPlatformLogResourceId(id)) throw iamAccountDenied();
    await platformManagementGroupSnapshot(principal, Permission.REMOTE_TERMINAL_ASSIGNMENT_WRITE);
    return this.read(prisma, id);
  }
  private async identity(tx: Prisma.TransactionClient, guard: TerminalEntitlementUpdateGuard) {
    if (guard.users.targetUserId !== guard.users.principal.subjectUserId) throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
    await tx.$queryRaw`SELECT id FROM \`groups\` WHERE id=${guard.group.id} FOR UPDATE`;
    const group = await platformManagementGroupSnapshot(
      guard.users.principal,
      Permission.REMOTE_TERMINAL_ASSIGNMENT_WRITE,
      tx,
    );
    if (group.id !== guard.group.id || group.updateTime.getTime() !== guard.group.updateTime.getTime())
      throw iamAccountDenied();
  }
  async update(
    target: TerminalEntitlementUpdateTarget,
    data: Prisma.RemoteTerminalUserEntitlementUncheckedUpdateInput,
    guard: TerminalEntitlementUpdateGuard,
  ) {
    const allowed = new Set([
      "name",
      "description",
      "startAt",
      "endAt",
      "purchaseUnits",
      "durationDays",
      "deviceLimit",
      "terminalLimit",
      "note",
      "status",
      "maxDeviceCount",
      "maxTerminalCount",
    ]);
    if (
      guard.operation !== "UpdateEntitlement" ||
      target.record.id !== guard.targetId ||
      target.record.userId !== guard.targetUserId ||
      terminalEntitlementUpdateRevision(target) !== target.revision ||
      Object.keys(data).some((key) => !allowed.has(key)) ||
      (data.status !== undefined && (typeof data.status !== "number" || ![-1, 0, 1].includes(data.status))) ||
      (data.status === -1 && !guard.deleteViaUpdate)
    )
      throw iamAccountDenied();
    for (const value of Object.values(data))
      if (value !== null && value !== undefined && typeof value === "object" && !(value instanceof Date))
        throw iamAccountDenied();
    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.identity(tx, guard);
          await tx.$queryRaw`SELECT id FROM users WHERE id=${target.user.id} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM remote_terminal_user_entitlements WHERE id=${target.record.id} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM remote_terminal_device_bindings WHERE entitlementId=${target.record.id} AND status>=0 ORDER BY id FOR UPDATE`;
          const current = await this.read(tx, target.record.id);
          if (!current || current.revision !== target.revision) throw iamAccountDenied();
          const limit = typeof data.deviceLimit === "number" ? data.deviceLimit : current.record.deviceLimit;
          if (current.deviceIds.length > limit)
            throw new BadRequestError("deviceLimit cannot be lower than current registered device count", undefined, {
              messageKey: "remoteTerminalProduct.deviceLimitBelowRegistered",
            });
          const updated = await tx.remoteTerminalUserEntitlement.update({ where: { id: target.record.id }, data });
          await this.identity(tx, guard);
          return updated;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        throw new ConflictError("Entitlement mutation source changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
}
