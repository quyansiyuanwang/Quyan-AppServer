import { Prisma } from "@prisma/client";
import { DEFAULT_USER_GROUP_USERNAME, Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { parseLegacyPermissions } from "@/iam/legacy-policy";
import { isPlatformUserId } from "@/iam/resources/platform-user-resources";
import { userViewDto } from "@/services/users/user-view";
import { ConflictError } from "@/util/errors";
import { iamAccountDenied } from "./iam-account-principal";
import { platformManagementGroupSnapshot } from "./platform-management-principal";
import { assertIamAccountUserMutation } from "./iam-account-user-mutation";
import { readIamAuthorizationRevision } from "./iam-authorization-revision";
import { PLATFORM_USER_VIEW_SELECT } from "./platform-user-read.store";
import type {
  PlatformUserCreateStore,
  PlatformUserCreateGroup,
  PlatformUserCreateGuard,
  PlatformUserCreateData,
} from "./platform-user-create.store";
const groupSelect = {
  id: true,
  username: true,
  accountOwnerId: true,
  status: true,
  level: true,
  updateTime: true,
  permissions: true,
} as const;
const transactionPolicy = Object.freeze({ timeoutMs: 30000 });
export class PlatformUserCreateRepository implements PlatformUserCreateStore {
  private static instance: PlatformUserCreateRepository;
  static getInstance() {
    return (this.instance ??= new PlatformUserCreateRepository());
  }
  private async read(principal: IamPrincipal, id: string | undefined, tx: Prisma.TransactionClient) {
    const qualified = await platformManagementGroupSnapshot(principal, Permission.USER_CREATE, tx);
    if (id !== undefined && !isPlatformUserId(id)) throw iamAccountDenied();
    const actor = await tx.user.findUnique({
      where: { id: principal.subjectUserId },
      select: {
        userType: true,
        accountOwnerId: true,
        group: { select: groupSelect },
      },
    });
    const destination =
      id === undefined
        ? await tx.group.findFirst({
            where: { username: DEFAULT_USER_GROUP_USERNAME, accountOwnerId: null, status: 1 },
            select: groupSelect,
          })
        : await tx.group.findUnique({ where: { id }, select: groupSelect });
    if (
      !actor?.group ||
      actor.group.id !== qualified.id ||
      !destination ||
      (id !== undefined && destination.id !== id) ||
      destination.status !== 1 ||
      destination.accountOwnerId !== null ||
      !Number.isSafeInteger(actor.group.level) ||
      !Number.isSafeInteger(destination.level)
    )
      throw iamAccountDenied();
    const recoveryBootstrap =
      principal.subjectType === "root" &&
      !principal.roleSessionId &&
      !principal.assumedRoleId &&
      principal.subjectUserId === principal.accountOwnerId &&
      actor.userType === "root" &&
      actor.accountOwnerId === null &&
      actor.group.username === env.security.superAdminGroupUsername;
    if (destination.level < actor.group.level || (!recoveryBootstrap && destination.level === actor.group.level))
      throw iamAccountDenied();
    return {
      id: destination.id,
      username: destination.username,
      level: destination.level,
      updateTime: destination.updateTime,
      permissions: parseLegacyPermissions(destination.permissions),
      recoveryBootstrap,
    };
  }
  destination(principal: IamPrincipal, id?: string) {
    return this.read(principal, id, prisma);
  }
  private same(actual: PlatformUserCreateGroup, expected: PlatformUserCreateGroup) {
    if (
      actual.id !== expected.id ||
      actual.username !== expected.username ||
      actual.level !== expected.level ||
      actual.updateTime.getTime() !== expected.updateTime.getTime() ||
      actual.recoveryBootstrap !== expected.recoveryBootstrap ||
      JSON.stringify([...actual.permissions].sort()) !== JSON.stringify([...expected.permissions].sort())
    )
      throw iamAccountDenied();
  }
  async recheck(principal: IamPrincipal, expected: PlatformUserCreateGroup, id?: string) {
    this.same(await this.destination(principal, id), expected);
  }
  async authorizationRevision(principal: IamPrincipal) {
    await platformManagementGroupSnapshot(principal, Permission.USER_CREATE);
    return readIamAuthorizationRevision(prisma, principal.accountOwnerId);
  }
  async created(
    principal: IamPrincipal,
    id: string,
    data: PlatformUserCreateData,
    destination: PlatformUserCreateGroup,
  ) {
    if (!isPlatformUserId(id) || id === principal.subjectUserId || id === principal.accountOwnerId)
      throw iamAccountDenied();
    const read = async () => {
      await platformManagementGroupSnapshot(principal, Permission.USER_CREATE);
      const row = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          username: true,
          userType: true,
          parentUserId: true,
          accountOwnerId: true,
          status: true,
          groupId: true,
          permissionAdds: true,
          permissionRemoves: true,
          updateTime: true,
        },
      });
      if (
        !row ||
        row.id !== id ||
        row.username !== data.username ||
        row.userType !== "root" ||
        row.parentUserId !== null ||
        row.accountOwnerId !== null ||
        row.status !== 1 ||
        row.groupId !== destination.id ||
        parseLegacyPermissions(row.permissionAdds).length ||
        parseLegacyPermissions(row.permissionRemoves).length
      )
        throw iamAccountDenied();
      return row.updateTime;
    };
    const expected = await read();
    return async () => {
      if ((await read()).getTime() !== expected.getTime()) throw iamAccountDenied();
    };
  }
  private async identity(tx: Prisma.TransactionClient, guard: PlatformUserCreateGuard) {
    await assertIamAccountUserMutation(tx, guard.users, guard.users.principal.subjectUserId);
    const current = await platformManagementGroupSnapshot(guard.users.principal, Permission.USER_CREATE, tx);
    if (
      current.id !== guard.group.id ||
      current.updateTime.getTime() !== guard.group.updateTime.getTime() ||
      (await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId)) !== guard.authorizationRevision
    )
      throw iamAccountDenied();
  }
  async create(guard: PlatformUserCreateGuard) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const principal = guard.users.principal;
          await this.identity(tx, guard);
          const groupIds = [...new Set([guard.group.id, guard.destination.id])].sort();
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM \`groups\` WHERE id IN (${Prisma.join(groupIds)}) ORDER BY id FOR UPDATE`,
          );
          this.same(await this.read(principal, guard.data.groupId, tx), guard.destination);
          const row = await tx.user.create({
            data: {
              username: guard.data.username,
              password: guard.data.password,
              email: guard.data.email ?? null,
              name: guard.data.name ?? null,
              userType: "root",
              accountOwnerId: null,
              parentUserId: null,
              status: 1,
              groupId: guard.destination.id,
              permissionAdds: [],
              permissionRemoves: [],
            },
            select: PLATFORM_USER_VIEW_SELECT,
          });
          if (
            !isPlatformUserId(row.id) ||
            row.id === principal.subjectUserId ||
            row.id === principal.accountOwnerId ||
            row.accountOwnerId !== null ||
            row.status !== 1 ||
            row.groupId !== guard.destination.id
          )
            throw iamAccountDenied();
          const revision = await readIamAuthorizationRevision(tx, row.id);
          await guard.authorizeCreated(row.id);
          await this.identity(tx, guard);
          this.same(await this.read(principal, guard.data.groupId, tx), guard.destination);
          if ((await readIamAuthorizationRevision(tx, row.id)) !== revision) throw iamAccountDenied();
          await guard.authorizeCreated(row.id);
          return userViewDto(row, row.balanceAccount, row.group);
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
