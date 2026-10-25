import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { isPlatformUserId } from "@/iam/resources/platform-user-resources";
import { userViewDto } from "@/services/users/user-view";
import { ConflictError } from "@/util/errors";
import { platformManagementGroupSnapshot } from "./platform-management-principal";
import { iamAccountDenied } from "./iam-account-principal";
import { assertIamAccountUserMutation } from "./iam-account-user-mutation";
import { readIamAuthorizationRevision, type IamAuthorizationUserUpdate } from "./iam-authorization-revision";
import { readPlatformUserTargets, samePlatformUserTargets } from "./platform-user-snapshot";
import { PLATFORM_USER_VIEW_SELECT } from "./platform-user-read.store";
import type {
  PlatformUserUpdateStore,
  PlatformUserUpdateTarget,
  PlatformUserUpdateGroup,
  PlatformUserUpdateGuard,
} from "./platform-user-update.store";
const groupSelect = { id: true, accountOwnerId: true, status: true, level: true, updateTime: true } as const;
const transactionPolicy = Object.freeze({ timeoutMs: 30000 });
export class PlatformUserUpdateRepository implements PlatformUserUpdateStore {
  private static instance: PlatformUserUpdateRepository;
  static getInstance() {
    return (this.instance ??= new PlatformUserUpdateRepository());
  }
  private qualify(principal: IamPrincipal, tx: Prisma.TransactionClient = prisma) {
    return platformManagementGroupSnapshot(principal, Permission.USER_UPDATE, tx);
  }
  private async read(principal: IamPrincipal, id: string, tx: Prisma.TransactionClient) {
    if (!isPlatformUserId(id)) throw iamAccountDenied();
    const qualified = await this.qualify(principal, tx);
    const actor = await tx.user.findUnique({
      where: { id: principal.subjectUserId },
      select: {
        id: true,
        userType: true,
        accountOwnerId: true,
        group: { select: { ...groupSelect, username: true } },
      },
    });
    const row = await tx.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        status: true,
        accountOwnerId: true,
        groupId: true,
        group: { select: groupSelect },
      },
    });
    if (
      !actor?.group ||
      actor.group.id !== qualified.id ||
      !row ||
      row.id !== id ||
      ![0, 1].includes(row.status) ||
      !row.group ||
      row.groupId !== row.group.id ||
      row.group.status !== 1 ||
      !Number.isSafeInteger(actor.group.level) ||
      !Number.isSafeInteger(row.group.level) ||
      (row.group.accountOwnerId !== null && row.group.accountOwnerId !== (row.accountOwnerId || row.id)) ||
      (id !== principal.subjectUserId && row.group.level <= actor.group.level)
    )
      throw iamAccountDenied();
    const accountOwnerId = row.accountOwnerId || row.id;
    if (row.accountOwnerId) {
      const owner = await tx.user.findUnique({
        where: { id: accountOwnerId },
        select: { id: true, status: true, accountOwnerId: true },
      });
      if (!owner || owner.id !== accountOwnerId || owner.status !== 1 || owner.accountOwnerId !== null)
        throw iamAccountDenied();
    }
    const resources = await readPlatformUserTargets(tx, [id]);
    if (resources.length !== 1) throw iamAccountDenied();
    return {
      resource: resources[0]!,
      accountOwnerId,
      group: row.group,
      actorLevel: actor.group.level,
      email: row.email,
      recoveryBootstrap:
        principal.subjectType === "root" &&
        !principal.assumedRoleId &&
        !principal.roleSessionId &&
        actor.id === principal.accountOwnerId &&
        actor.accountOwnerId === null &&
        actor.userType === "root" &&
        actor.group.accountOwnerId === null &&
        actor.group.username === env.security.superAdminGroupUsername,
    };
  }
  target(principal: IamPrincipal, id: string) {
    return this.read(principal, id, prisma);
  }
  private async readDestination(
    principal: IamPrincipal,
    target: PlatformUserUpdateTarget,
    id: string,
    tx: Prisma.TransactionClient,
  ) {
    if (!isPlatformUserId(id)) throw iamAccountDenied();
    await this.qualify(principal, tx);
    const group = await tx.group.findUnique({ where: { id }, select: groupSelect });
    if (
      !group ||
      group.id !== id ||
      group.status !== 1 ||
      !Number.isSafeInteger(group.level) ||
      (group.accountOwnerId !== null && group.accountOwnerId !== target.accountOwnerId) ||
      group.level < (target.recoveryBootstrap ? target.actorLevel : target.group.level)
    )
      throw iamAccountDenied();
    return group;
  }
  destination(principal: IamPrincipal, target: PlatformUserUpdateTarget, id: string) {
    return this.readDestination(principal, target, id, prisma);
  }
  private async revision(
    principal: IamPrincipal,
    targetAccountOwnerId: string,
    tx: Prisma.TransactionClient,
    userUpdate?: IamAuthorizationUserUpdate,
  ) {
    const revisions: string[] = [];
    for (const owner of [...new Set([principal.accountOwnerId, targetAccountOwnerId])].sort())
      revisions.push(
        owner +
          ":" +
          (await readIamAuthorizationRevision(tx, owner, owner === targetAccountOwnerId ? userUpdate : undefined)),
      );
    return createHash("sha256").update(JSON.stringify(revisions)).digest("hex");
  }
  async authorizationRevision(principal: IamPrincipal, targetAccountOwnerId: string) {
    await this.qualify(principal);
    return this.revision(principal, targetAccountOwnerId, prisma);
  }
  private sameGroup(current: PlatformUserUpdateGroup, previous: PlatformUserUpdateGroup) {
    if (
      current.id !== previous.id ||
      current.accountOwnerId !== previous.accountOwnerId ||
      current.level !== previous.level ||
      current.updateTime.getTime() !== previous.updateTime.getTime()
    )
      throw iamAccountDenied();
  }
  private same(current: PlatformUserUpdateTarget, expected: PlatformUserUpdateTarget) {
    samePlatformUserTargets([current.resource], [expected.resource]);
    this.sameGroup(current.group, expected.group);
    if (
      current.accountOwnerId !== expected.accountOwnerId ||
      current.email !== expected.email ||
      current.actorLevel !== expected.actorLevel ||
      current.recoveryBootstrap !== expected.recoveryBootstrap
    )
      throw iamAccountDenied();
  }
  async recheck(principal: IamPrincipal, target: PlatformUserUpdateTarget, destination?: PlatformUserUpdateGroup) {
    this.same(await this.target(principal, target.resource.id), target);
    if (destination) this.sameGroup(await this.destination(principal, target, destination.id), destination);
  }
  private async identity(
    tx: Prisma.TransactionClient,
    guard: PlatformUserUpdateGuard,
    userUpdate?: IamAuthorizationUserUpdate,
  ) {
    await assertIamAccountUserMutation(tx, guard.users, guard.users.principal.subjectUserId);
    const group = await this.qualify(guard.users.principal, tx);
    if (
      group.id !== guard.group.id ||
      group.updateTime.getTime() !== guard.group.updateTime.getTime() ||
      (await this.revision(guard.users.principal, guard.target.accountOwnerId, tx, userUpdate)) !==
        guard.authorizationRevision
    )
      throw iamAccountDenied();
  }
  async update(guard: PlatformUserUpdateGuard) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const principal = guard.users.principal,
            id = guard.target.resource.id;
          await this.identity(tx, guard);
          const ids = [...new Set([id, guard.target.accountOwnerId])].sort();
          await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
          const groups = [
            ...new Set([guard.group.id, guard.target.group.id, ...(guard.destination ? [guard.destination.id] : [])]),
          ].sort();
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM \`groups\` WHERE id IN (${Prisma.join(groups)}) ORDER BY id FOR UPDATE`,
          );
          this.same(await this.read(principal, id, tx), guard.target);
          if (guard.destination)
            this.sameGroup(
              await this.readDestination(principal, guard.target, guard.destination.id, tx),
              guard.destination,
            );
          const data = guard.data;
          if (
            (data.groupId !== undefined && data.groupId !== guard.destination?.id) ||
            ((id === principal.subjectUserId || id === principal.accountOwnerId) &&
              ((data.groupId !== undefined && data.groupId !== guard.target.group.id) ||
                (data.email !== undefined && data.email !== guard.target.email) ||
                data.status === 0))
          )
            throw iamAccountDenied();
          const row = await tx.user.update({
            where: { id },
            data: {
              ...(data.name !== undefined ? { name: data.name } : {}),
              ...(data.email !== undefined ? { email: data.email } : {}),
              ...(data.status !== undefined ? { status: data.status } : {}),
              ...(data.groupId !== undefined ? { groupId: data.groupId } : {}),
            },
            select: PLATFORM_USER_VIEW_SELECT,
          });
          // Self profile writes have an expected post-image. Validate it in this transaction, not against stale timestamps.
          const postGuard = {
            ...guard,
            users: {
              ...guard.users,
              users: guard.users.users.map((user) =>
                user.id === row.id ? { ...user, updateTime: row.updateTime } : user,
              ),
            },
          };
          await this.identity(tx, postGuard, {
            before: {
              id,
              status: guard.target.resource.status,
              groupId: guard.target.group.id,
              updateTime: guard.target.resource.updateTime,
            },
            after: row,
          });
          await guard.users.recheck();
          if (
            row.id !== id ||
            row.accountOwnerId !== (guard.target.accountOwnerId === id ? null : guard.target.accountOwnerId) ||
            row.groupId !== (data.groupId ?? guard.target.group.id) ||
            row.status !== (data.status ?? guard.target.resource.status)
          )
            throw iamAccountDenied();
          return {
            user: userViewDto(row, row.balanceAccount, row.group),
            previousStatus: guard.target.resource.status,
          };
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
