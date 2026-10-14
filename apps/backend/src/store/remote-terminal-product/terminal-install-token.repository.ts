import { assertTerminalInstallCredential } from "./terminal-install-credential";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { isRemoteTerminalId } from "@/iam/resources/remote-terminal-resources";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { assertIamAccountPrincipal, iamAccountDenied } from "../users/iam-account-principal";
import { BadRequestError, ConflictError } from "@/util/errors";
import type {
  TerminalInstallTokenStore,
  TerminalInstallTarget,
  TerminalInstallGuard,
} from "./terminal-install-token.store";
/** Signing requires entitlement metadata only; existing credentials and device relations are never selected. */
export const TERMINAL_INSTALL_TARGET_SELECT = {
  id: true,
  userId: true,
  status: true,
  deviceLimit: true,
  updateTime: true,
} as const;
export class TerminalInstallTokenRepository implements TerminalInstallTokenStore {
  private static instance: TerminalInstallTokenRepository;
  static getInstance() {
    return (this.instance ??= new TerminalInstallTokenRepository());
  }
  private async read(tx: Prisma.TransactionClient, principal: IamPrincipal, id: string) {
    const row = await tx.remoteTerminalUserEntitlement.findFirst({
      where: { id, userId: principal.subjectUserId, status: { in: [0, 1] } },
      select: TERMINAL_INSTALL_TARGET_SELECT,
    });
    return row?.id === id && row.userId === principal.subjectUserId ? row : null;
  }
  async target(principal: IamPrincipal, id: string) {
    if (!isRemoteTerminalId(id)) throw iamAccountDenied();
    await assertIamAccountPrincipal(principal);
    return this.read(prisma, principal, id);
  }
  async issue<T>(target: TerminalInstallTarget, guard: TerminalInstallGuard, generate: () => T | Promise<T>) {
    const principal = guard.users.principal;
    if (
      !isRemoteTerminalId(target.id) ||
      target.id !== guard.targetId ||
      target.userId !== principal.subjectUserId ||
      guard.users.targetUserId !== target.userId
    )
      throw iamAccountDenied();
    try {
      return await prisma.$transaction(
        async (tx) => {
          await assertIamAccountUserMutation(tx, guard.users, target.userId);
          await assertTerminalInstallCredential(tx, principal, guard.accessKeyId);
          const authorizationRevision = await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId);
          await tx.$queryRaw`SELECT id FROM remote_terminal_user_entitlements WHERE id=${target.id} FOR UPDATE`;
          const current = await this.read(tx, principal, target.id);
          if (
            !current ||
            current.status !== target.status ||
            current.deviceLimit !== target.deviceLimit ||
            current.updateTime.getTime() !== target.updateTime.getTime()
          )
            throw iamAccountDenied();
          if (current.deviceLimit <= 0)
            throw new BadRequestError("Registration token is unavailable when deviceLimit is 0", undefined, {
              messageKey: "remoteTerminalProduct.registrationTokenUnavailable",
            });
          const result = await generate();
          await assertIamAccountUserMutation(tx, guard.users, target.userId);
          await assertTerminalInstallCredential(tx, principal, guard.accessKeyId);
          if ((await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId)) !== authorizationRevision)
            throw iamAccountDenied();
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        throw new ConflictError("Install token source changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
}
