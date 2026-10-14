import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  IAM_REMOTE_TERMINAL_MANAGEMENT_MUTATIONS,
  type IamPrincipal,
  type IamTerminalManagementMutation,
} from "@quyan/shared";
import { prisma } from "@/config/database";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { iamAccountDenied } from "../users/iam-account-principal";
import { ConflictError } from "@/util/errors";
import type {
  PlatformTerminalManagementMutationStore,
  TerminalManagementTarget,
  TerminalManagementMutationGuard,
  TerminalManagementKind,
} from "./platform-terminal-management-mutation.store";
const definition = (operation: IamTerminalManagementMutation) => {
  const value = IAM_REMOTE_TERMINAL_MANAGEMENT_MUTATIONS.find((entry) => entry.operation === operation);
  if (!value) throw iamAccountDenied();
  return value;
};
export function terminalManagementRevision(target: Omit<TerminalManagementTarget, "revision">) {
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
export class PlatformTerminalManagementMutationRepository implements PlatformTerminalManagementMutationStore {
  private static instance: PlatformTerminalManagementMutationRepository;
  static getInstance() {
    return (this.instance ??= new PlatformTerminalManagementMutationRepository());
  }
  async owner(principal: IamPrincipal, operation: IamTerminalManagementMutation, id: string) {
    if (!isPlatformLogResourceId(id)) throw iamAccountDenied();
    const entry = definition(operation);
    await platformManagementGroupSnapshot(principal, entry.permission);
    const row =
      entry.kind === "binding"
        ? await prisma.remoteTerminalDeviceBinding.findFirst({
            where: { id, status: { in: [0, 1] } },
            select: { userId: true },
          })
        : await prisma.remoteTerminalUserEntitlement.findFirst({
            where: { id, status: { in: [0, 1] } },
            select: { userId: true },
          });
    return row && isPlatformLogResourceId(row.userId) ? row.userId : undefined;
  }
  private async read(
    tx: Prisma.TransactionClient,
    kind: TerminalManagementKind,
    id: string,
  ): Promise<TerminalManagementTarget | null> {
    let target: Omit<TerminalManagementTarget, "revision">;
    if (kind === "binding") {
      const row = await tx.remoteTerminalDeviceBinding.findFirst({
        where: { id, status: { in: [0, 1] } },
        select: {
          id: true,
          userId: true,
          status: true,
          updateTime: true,
          hostname: true,
          online: true,
          entitlementId: true,
        },
      });
      if (!row) return null;
      const { hostname, ...fields } = row;
      target = { kind, ...fields, label: hostname };
    } else {
      const row = await tx.remoteTerminalUserEntitlement.findFirst({
        where: { id, status: { in: [0, 1] } },
        select: { id: true, userId: true, status: true, updateTime: true, name: true, unbindResetAt: true },
      });
      if (!row) return null;
      const { name, ...fields } = row;
      target = { kind, ...fields, label: name };
    }
    return { ...target, revision: terminalManagementRevision(target) };
  }
  async target(principal: IamPrincipal, operation: IamTerminalManagementMutation, id: string) {
    if (!isPlatformLogResourceId(id)) throw iamAccountDenied();
    const entry = definition(operation);
    await platformManagementGroupSnapshot(principal, entry.permission);
    return this.read(prisma, entry.kind, id);
  }
  private async identity(tx: Prisma.TransactionClient, guard: TerminalManagementMutationGuard) {
    if (guard.users.targetUserId !== guard.users.principal.subjectUserId) throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
    await tx.$queryRaw`SELECT id FROM \`groups\` WHERE id=${guard.group.id} FOR UPDATE`;
    const current = await platformManagementGroupSnapshot(
      guard.users.principal,
      definition(guard.operation).permission,
      tx,
    );
    if (current.id !== guard.group.id || current.updateTime.getTime() !== guard.group.updateTime.getTime())
      throw iamAccountDenied();
  }
  async mutate(target: TerminalManagementTarget, guard: TerminalManagementMutationGuard) {
    const entry = definition(guard.operation);
    if (
      target.kind !== entry.kind ||
      target.id !== guard.targetId ||
      target.userId !== guard.targetUserId ||
      !isPlatformLogResourceId(target.id) ||
      !isPlatformLogResourceId(target.userId) ||
      terminalManagementRevision(target) !== target.revision
    )
      throw iamAccountDenied();
    try {
      await prisma.$transaction(
        async (tx) => {
          await this.identity(tx, guard);
          if (entry.kind === "binding")
            await tx.$queryRaw`SELECT id FROM remote_terminal_device_bindings WHERE id=${target.id} FOR UPDATE`;
          else await tx.$queryRaw`SELECT id FROM remote_terminal_user_entitlements WHERE id=${target.id} FOR UPDATE`;
          const current = await this.read(tx, entry.kind, target.id);
          if (!current || current.revision !== target.revision) throw iamAccountDenied();
          if (current.kind === "binding") {
            const parent = await tx.remoteTerminalUserEntitlement.findUnique({
              where: { id: current.entitlementId },
              select: { userId: true },
            });
            if (!parent || parent.userId !== current.userId) throw iamAccountDenied();
            // Administrator revocation bypasses the personal allowance check; deleted bindings still count in its history.
            await tx.remoteTerminalDeviceBinding.update({
              where: { id: current.id },
              data: { status: -1, online: false },
            });
          } else {
            await tx.remoteTerminalUserEntitlement.update({
              where: { id: current.id },
              data: guard.operation === "DeleteEntitlement" ? { status: -1 } : { unbindResetAt: new Date() },
            });
          }
          await this.identity(tx, guard);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        throw new ConflictError("Terminal management mutation source changed", undefined, {
          messageKey: "errors.conflict",
        });
      throw error;
    }
  }
}
