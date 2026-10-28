import { Prisma } from "@prisma/client";
import { Permission } from "@quyan/shared";
import type { IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { isPlatformUserId } from "@/iam/resources/platform-user-resources";
import { platformManagementGroupSnapshot } from "./platform-management-principal";
import { iamAccountDenied } from "./iam-account-principal";
import { assertIamAccountUserMutation } from "./iam-account-user-mutation";
import { readIamAuthorizationRevision } from "./iam-authorization-revision";
import { readPlatformUserTargets, samePlatformUserTargets } from "./platform-user-snapshot";
import type {
  PlatformUserDeleteStore,
  PlatformUserDeleteGuard,
  PlatformUserDeleteTarget,
} from "./platform-user-delete.store";
import { AccountStatus } from "@/util/auth/account-status";
import { ConflictError } from "@/util/errors";
const permission = Permission.USER_DELETE,
  transactionPolicy = Object.freeze({ timeoutMs: 30000 });
export class PlatformUserDeleteRepository implements PlatformUserDeleteStore {
  private static instance: PlatformUserDeleteRepository;
  static getInstance() {
    return (this.instance ??= new PlatformUserDeleteRepository());
  }
  private qualify(principal: IamPrincipal, tx: Prisma.TransactionClient = prisma) {
    return platformManagementGroupSnapshot(principal, permission, tx);
  }
  private async read(
    principal: IamPrincipal,
    id: string,
    tx: Prisma.TransactionClient,
    lock = false,
  ): Promise<PlatformUserDeleteTarget> {
    if (!isPlatformUserId(id) || id === principal.subjectUserId || id === principal.accountOwnerId)
      throw iamAccountDenied();
    const group = await this.qualify(principal, tx),
      resources = await readPlatformUserTargets(tx, [id], lock);
    const actorGroup = await tx.group.findUnique({ where: { id: group.id }, select: { level: true } }),
      target = await tx.user.findFirst({
        where: { id, status: { in: [AccountStatus.DISABLED, AccountStatus.ACTIVE] } },
        select: { id: true, username: true, groupId: true, group: { select: { id: true, level: true, status: true } } },
      });
    if (
      resources.length !== 1 ||
      !actorGroup ||
      !target?.group ||
      target.group.status !== 1 ||
      target.groupId !== target.group.id ||
      !Number.isSafeInteger(actorGroup.level) ||
      !Number.isSafeInteger(target.group.level) ||
      target.group.level <= actorGroup.level
    )
      throw iamAccountDenied();
    const resource = resources[0]!;
    samePlatformUserTargets(await readPlatformUserTargets(tx, [id]), [resource]);
    return {
      resource,
      username: target.username,
      groupId: target.group.id,
      actorLevel: actorGroup.level,
      targetLevel: target.group.level,
    };
  }
  target(principal: IamPrincipal, id: string) {
    return this.read(principal, id, prisma);
  }
  async authorizationRevision(principal: IamPrincipal) {
    await this.qualify(principal);
    return readIamAuthorizationRevision(prisma, principal.accountOwnerId);
  }
  private same(current: PlatformUserDeleteTarget, expected: PlatformUserDeleteTarget) {
    samePlatformUserTargets([current.resource], [expected.resource]);
    if (
      current.actorLevel !== expected.actorLevel ||
      current.targetLevel !== expected.targetLevel ||
      current.groupId !== expected.groupId ||
      current.username !== expected.username
    )
      throw iamAccountDenied();
  }
  async recheck(principal: IamPrincipal, expected: PlatformUserDeleteTarget) {
    this.same(await this.target(principal, expected.resource.id), expected);
  }
  private async identity(tx: Prisma.TransactionClient, guard: PlatformUserDeleteGuard) {
    await assertIamAccountUserMutation(tx, guard.users, guard.users.principal.subjectUserId);
    const group = await this.qualify(guard.users.principal, tx);
    if (
      guard.action !== "quyan:user:DeleteUser" ||
      group.id !== guard.group.id ||
      group.updateTime.getTime() !== guard.group.updateTime.getTime() ||
      (await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId)) !== guard.authorizationRevision
    )
      throw iamAccountDenied();
    const actorGroup = await tx.group.findUnique({ where: { id: group.id }, select: { level: true } });
    if (!actorGroup || actorGroup.level !== guard.target.actorLevel) throw iamAccountDenied();
  }
  async remove(guard: PlatformUserDeleteGuard) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.identity(tx, guard);
          const id = guard.target.resource.id;
          await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id=${id} FOR UPDATE`);
          const groups = [...new Set([guard.group.id, guard.target.groupId])].sort();
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM \`groups\` WHERE id IN (${Prisma.join(groups)}) ORDER BY id FOR UPDATE`,
          );
          this.same(await this.read(guard.users.principal, id, tx, true), guard.target);
          const row = await tx.user.update({
            where: { id },
            data: { status: AccountStatus.DELETED, username: guard.target.username + "_del_" + Date.now() },
            select: { id: true },
          });
          // Grant revocation after SQL must roll back both the status and renamed username.
          await this.identity(tx, guard);
          await guard.users.recheck();
          return { id: row.id, username: guard.target.username };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: transactionPolicy.timeoutMs },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code))
        throw new ConflictError("User or authorization changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
}
