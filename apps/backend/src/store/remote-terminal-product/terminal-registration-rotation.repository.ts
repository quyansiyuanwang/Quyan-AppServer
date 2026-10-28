import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  IAM_TERMINAL_REGISTRATION_ROTATIONS,
  Permission,
  type IamPrincipal,
  type IamTerminalRegistrationRotation,
} from "@quyan/shared";
import { prisma } from "@/config/database";
import { isRemoteTerminalId } from "@/iam/resources/remote-terminal-resources";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { assertIamAccountPrincipal, iamAccountDenied } from "../users/iam-account-principal";
import { BadRequestError, ConflictError } from "@/util/errors";
import type {
  TerminalRegistrationRotationStore,
  TerminalRegistrationRotationTarget,
  TerminalRegistrationRotationGuard,
  TerminalRegistrationRotationInput,
} from "./terminal-registration-rotation.store";
export const TERMINAL_REGISTRATION_METADATA_SELECT = {
  id: true,
  entitlementId: true,
  status: true,
  createTime: true,
  updateTime: true,
  label: true,
  expiresAt: true,
  lastUsedAt: true,
} as const;
const definition = (operation: IamTerminalRegistrationRotation) => {
  const value = IAM_TERMINAL_REGISTRATION_ROTATIONS.find((entry) => entry.operation === operation);
  if (!value) throw iamAccountDenied();
  return value;
};
export function terminalRegistrationRevision(row: Omit<TerminalRegistrationRotationTarget, "revision">) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        Object.keys(row)
          .filter((key) => key !== "revision")
          .sort()
          .map((key) => [key, row[key as keyof typeof row]]),
      ),
    )
    .digest("hex");
}
export class TerminalRegistrationRotationRepository implements TerminalRegistrationRotationStore {
  private static instance: TerminalRegistrationRotationRepository;
  static getInstance() {
    return (this.instance ??= new TerminalRegistrationRotationRepository());
  }
  private async identity(
    principal: IamPrincipal,
    operation: IamTerminalRegistrationRotation,
    tx: Prisma.TransactionClient = prisma,
  ) {
    if (definition(operation).management)
      await platformManagementGroupSnapshot(principal, Permission.REMOTE_TERMINAL_REGISTRATION_TOKEN_WRITE, tx);
    else await assertIamAccountPrincipal(principal, tx);
  }
  private where(principal: IamPrincipal, operation: IamTerminalRegistrationRotation, id: string) {
    return {
      id,
      status: { in: [0, 1] },
      ...(definition(operation).management ? {} : { userId: principal.subjectUserId }),
    };
  }
  async owner(principal: IamPrincipal, operation: IamTerminalRegistrationRotation, id: string) {
    if (!isRemoteTerminalId(id)) throw iamAccountDenied();
    await this.identity(principal, operation);
    const row = await prisma.remoteTerminalUserEntitlement.findFirst({
      where: this.where(principal, operation, id),
      select: { id: true, userId: true },
    });
    return row?.id === id && isRemoteTerminalId(row.userId) ? row.userId : undefined;
  }
  private async read(
    tx: Prisma.TransactionClient,
    principal: IamPrincipal,
    operation: IamTerminalRegistrationRotation,
    id: string,
  ): Promise<TerminalRegistrationRotationTarget | null> {
    const row = await tx.remoteTerminalUserEntitlement.findFirst({
      where: this.where(principal, operation, id),
      select: {
        id: true,
        userId: true,
        name: true,
        status: true,
        deviceLimit: true,
        updateTime: true,
        registrationToken: { select: TERMINAL_REGISTRATION_METADATA_SELECT },
      },
    });
    if (
      !row ||
      row.id !== id ||
      !isRemoteTerminalId(row.userId) ||
      (row.registrationToken && row.registrationToken.entitlementId !== id)
    )
      return null;
    return { ...row, revision: terminalRegistrationRevision(row) };
  }
  async target(principal: IamPrincipal, operation: IamTerminalRegistrationRotation, id: string) {
    if (!isRemoteTerminalId(id)) throw iamAccountDenied();
    await this.identity(principal, operation);
    return this.read(prisma, principal, operation, id);
  }
  private async guard(tx: Prisma.TransactionClient, guard: TerminalRegistrationRotationGuard) {
    if (guard.users.targetUserId !== guard.users.principal.subjectUserId) throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
    await this.identity(guard.users.principal, guard.operation, tx);
    if (definition(guard.operation).management) {
      if (!guard.group) throw iamAccountDenied();
      await tx.$queryRaw`SELECT id FROM \`groups\` WHERE id=${guard.group.id} FOR UPDATE`;
      const current = await platformManagementGroupSnapshot(
        guard.users.principal,
        Permission.REMOTE_TERMINAL_REGISTRATION_TOKEN_WRITE,
        tx,
      );
      if (current.id !== guard.group.id || current.updateTime.getTime() !== guard.group.updateTime.getTime())
        throw iamAccountDenied();
    } else if (guard.group || guard.targetUserId !== guard.users.principal.subjectUserId) throw iamAccountDenied();
  }
  async rotate(
    target: TerminalRegistrationRotationTarget,
    data: TerminalRegistrationRotationInput,
    guard: TerminalRegistrationRotationGuard,
  ) {
    if (
      target.id !== guard.targetId ||
      target.userId !== guard.targetUserId ||
      !isRemoteTerminalId(target.id) ||
      terminalRegistrationRevision(target) !== target.revision ||
      !/^rtm_[0-9a-f]{48}$/.test(data.token) ||
      (data.expiresAt !== null && (!(data.expiresAt instanceof Date) || !Number.isFinite(data.expiresAt.getTime())))
    )
      throw iamAccountDenied();
    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.guard(tx, guard);
          const authorizationRevision = await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId);
          await tx.$queryRaw`SELECT id FROM remote_terminal_user_entitlements WHERE id=${target.id} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM remote_terminal_entitlement_tokens WHERE entitlementId=${target.id} FOR UPDATE`;
          const current = await this.read(tx, guard.users.principal, guard.operation, target.id);
          if (!current || current.revision !== target.revision) throw iamAccountDenied();
          if (current.deviceLimit <= 0)
            throw new BadRequestError("Registration token is unavailable when deviceLimit is 0", undefined, {
              messageKey: "remoteTerminalProduct.registrationTokenUnavailable",
            });
          if (current.registrationToken) await guard.recheckToken(current.registrationToken.id);
          const row = await tx.remoteTerminalEntitlementToken.upsert({
            where: { entitlementId: current.id },
            create: { entitlementId: current.id, ...data, status: 1 },
            update: { ...data, lastUsedAt: null, status: 1 },
          });
          await this.guard(tx, guard);
          await guard.recheckToken(row.id);
          if ((await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId)) !== authorizationRevision)
            throw iamAccountDenied();
          return row;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new ConflictError("Registration token source changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
}
