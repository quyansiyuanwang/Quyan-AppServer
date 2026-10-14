import type { IamManagementPage } from "@/iam/management-pagination";
import { ConflictError } from "@/util/errors";
import { AccountStatus } from "@/util/auth/account-status";
import { prisma } from "@/config/database";
import type {
  ActiveRamRoleSession,
  CreateRamRoleInput,
  RamRoleBindingRecord,
  RamRoleStore,
  RamRoleWithBindings,
  UpdateRamRoleInput,
} from "./ram-role.store";
import { Prisma, type RamRole, type RamRoleSession } from "@prisma/client";

const ACTIVE_WHERE = { status: AccountStatus.ACTIVE } as const;

export class RamRoleRepository implements RamRoleStore {
  private static instance: RamRoleRepository;

  static getInstance(): RamRoleRepository {
    if (!RamRoleRepository.instance) RamRoleRepository.instance = new RamRoleRepository();
    return RamRoleRepository.instance;
  }

  async createRole(data: CreateRamRoleInput): Promise<RamRole> {
    return prisma.ramRole.create({
      data: {
        accountOwnerId: data.accountOwnerId,
        name: data.name,
        description: data.description ?? null,
        trustPolicy:
          data.trustPolicy === null ? Prisma.JsonNull : (data.trustPolicy as Prisma.InputJsonValue | undefined),
        maxSessionDuration: data.maxSessionDuration ?? 3600,
        status: AccountStatus.ACTIVE,
      },
    });
  }

  async findRoleById(roleId: string): Promise<RamRole | null> {
    return prisma.ramRole.findFirst({ where: { id: roleId, ...ACTIVE_WHERE } });
  }

  async findRoleByName(accountOwnerId: string, name: string): Promise<RamRole | null> {
    return prisma.ramRole.findFirst({ where: { accountOwnerId, name, ...ACTIVE_WHERE } });
  }

  async listRoles(accountOwnerId: string): Promise<RamRole[]> {
    return prisma.ramRole.findMany({ where: { accountOwnerId, ...ACTIVE_WHERE }, orderBy: { createTime: "desc" } });
  }

  async listRolesPage(accountOwnerId: string, pagination: IamManagementPage) {
    const candidates = await prisma.ramRole.findMany({
      where: { accountOwnerId, ...ACTIVE_WHERE },
      orderBy: [{ createTime: "desc" }, { id: "asc" }],
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize + 1,
    });
    return {
      items: candidates.slice(0, pagination.pageSize),
      ...pagination,
      hasNext: candidates.length > pagination.pageSize,
    };
  }

  async updateRole(roleId: string, data: UpdateRamRoleInput): Promise<RamRole> {
    const updateData: Prisma.RamRoleUncheckedUpdateInput = {};
    if (data.description !== undefined) updateData.description = data.description;
    if (data.trustPolicy !== undefined)
      updateData.trustPolicy =
        data.trustPolicy === null ? Prisma.JsonNull : (data.trustPolicy as Prisma.InputJsonValue);
    if (data.maxSessionDuration !== undefined) updateData.maxSessionDuration = data.maxSessionDuration;
    if (data.status !== undefined) updateData.status = data.status;

    if (!data.expectedUpdateTime) return prisma.ramRole.update({ where: { id: roleId }, data: updateData });
    updateData.updateTime = new Date(Math.max(Date.now(), data.expectedUpdateTime.getTime() + 1));
    return prisma.$transaction(
      async (tx) => {
        const result = await tx.ramRole.updateMany({
          where: { id: roleId, status: AccountStatus.ACTIVE, updateTime: data.expectedUpdateTime },
          data: updateData,
        });
        if (result.count !== 1)
          throw new ConflictError("Role version changed", undefined, { messageKey: "iam.versionConflict" });
        return tx.ramRole.findUniqueOrThrow({ where: { id: roleId } });
      },
      { isolationLevel: "Serializable" },
    );
  }

  async softDeleteRole(roleId: string): Promise<RamRole> {
    return prisma.ramRole.update({ where: { id: roleId }, data: { status: AccountStatus.DELETED } });
  }

  async bindRoleToUser(accountOwnerId: string, roleId: string, userId: string): Promise<void> {
    await prisma.ramUserRoleBinding.upsert({
      where: { accountOwnerId_userId_roleId: { accountOwnerId, userId, roleId } },
      create: { accountOwnerId, roleId, userId },
      update: {},
    });
  }

  async unbindRoleFromUser(roleId: string, userId: string): Promise<void> {
    await prisma.ramUserRoleBinding.deleteMany({ where: { roleId, userId } });
  }

  async bindRoleToGroup(accountOwnerId: string, roleId: string, groupId: string): Promise<void> {
    await prisma.ramGroupRoleBinding.upsert({
      where: { accountOwnerId_groupId_roleId: { accountOwnerId, groupId, roleId } },
      create: { accountOwnerId, roleId, groupId },
      update: {},
    });
  }

  async unbindRoleFromGroup(roleId: string, groupId: string): Promise<void> {
    await prisma.ramGroupRoleBinding.deleteMany({ where: { roleId, groupId } });
  }

  async listRoleBindingsForUser(
    userId: string,
    groupId?: string | null,
    projection?: { groupAccountOwnerId: string },
  ): Promise<RamRoleBindingRecord[]> {
    // Derive scope from persisted identity, never from a caller-supplied group or binding.
    let accountOwnerId: string;
    let effectiveGroupId: string | undefined;
    if (userId) {
      // A projection option must never override a real user's persisted identity.
      if (projection) return [];
      const user = await prisma.user.findFirst({
        where: { id: userId, ...ACTIVE_WHERE },
        select: {
          id: true,
          accountOwnerId: true,
          groupId: true,
          group: { select: { id: true, status: true, accountOwnerId: true } },
        },
      });
      if (!user) return [];
      accountOwnerId = user.accountOwnerId || user.id;
      if (
        groupId &&
        groupId === user.groupId &&
        user.group?.status === AccountStatus.ACTIVE &&
        (!user.group.accountOwnerId || user.group.accountOwnerId === accountOwnerId)
      )
        effectiveGroupId = user.group.id;
    } else {
      // Global groups have no intrinsic namespace. Callers must resolve the real target account first.
      // The default internal call still accepts only account-owned groups for RAM compatibility.
      if (userId !== "" || !groupId) return [];
      const namespace = projection?.groupAccountOwnerId;
      if (projection && (!namespace || !/^[A-Za-z0-9_-]{1,128}$/.test(namespace))) return [];
      const group = await prisma.group.findFirst({
        where: { id: groupId, ...ACTIVE_WHERE, ...(projection ? {} : { accountOwnerId: { not: null } }) },
        select: { id: true, accountOwnerId: true },
      });
      if (
        !group ||
        group.id !== groupId ||
        (group.accountOwnerId !== null && namespace && group.accountOwnerId !== namespace)
      )
        return [];
      accountOwnerId = namespace ?? group.accountOwnerId!;
      if (!accountOwnerId) return [];
      effectiveGroupId = group.id;
    }
    const [userBindings, groupBindings] = await Promise.all([
      userId
        ? prisma.ramUserRoleBinding.findMany({
            where: { userId, accountOwnerId, ...ACTIVE_WHERE, role: { accountOwnerId, ...ACTIVE_WHERE } },
            include: { role: true },
          })
        : Promise.resolve([]),
      effectiveGroupId
        ? prisma.ramGroupRoleBinding.findMany({
            where: {
              groupId: effectiveGroupId,
              accountOwnerId,
              ...ACTIVE_WHERE,
              role: { accountOwnerId, ...ACTIVE_WHERE },
            },
            include: { role: true },
          })
        : Promise.resolve([]),
    ]);

    const allBindings = [
      ...userBindings.map((b) => ({ ...b, source: "user" as const, principalId: b.userId })),
      ...groupBindings.map((b) => ({ ...b, source: "group" as const, principalId: b.groupId })),
    ];

    // Fetch role permissions from attached policies
    const roleIds = [...new Set(allBindings.map((b) => b.roleId))];
    if (!roleIds.length) return [];
    const policyAttachments = await prisma.ramPolicyAttachment.findMany({
      where: {
        accountOwnerId,
        targetType: "role",
        targetId: { in: roleIds },
        ...ACTIVE_WHERE,
        policy: { accountOwnerId, ...ACTIVE_WHERE },
      },
      include: { policy: { select: { permissions: true } } },
    });

    const rolePermissionsMap = new Map<string, string[]>();
    for (const attachment of policyAttachments) {
      const perms = rolePermissionsMap.get(attachment.targetId) || [];
      const policyPerms = Array.isArray(attachment.policy.permissions)
        ? attachment.policy.permissions.filter((p): p is string => typeof p === "string")
        : [];
      rolePermissionsMap.set(attachment.targetId, [...perms, ...policyPerms]);
    }

    return allBindings.map((binding) => ({
      id: binding.id,
      roleId: binding.roleId,
      roleName: binding.role.name,
      permissions: [...new Set(rolePermissionsMap.get(binding.roleId) || [])],
      source: binding.source,
      principalId: binding.principalId,
    }));
  }

  async listRoleBindingsByRole(roleId: string): Promise<RamRoleWithBindings | null> {
    return prisma.ramRole.findFirst({
      where: { id: roleId, ...ACTIVE_WHERE },
      include: { userBindings: true, groupBindings: true },
    });
  }

  /** Stable source order: direct user bindings, then group bindings; each source is time/id ordered. */
  async listRoleBindingPage(
    accountOwnerId: string,
    roleId: string,
    pagination: IamManagementPage,
    target?: { userId: string; groupId?: string | null },
  ) {
    const { page, pageSize } = pagination,
      skip = (page - 1) * pageSize;
    const userWhere: Prisma.RamUserRoleBindingWhereInput = {
      accountOwnerId,
      roleId,
      ...ACTIVE_WHERE,
      ...(target ? { userId: target.userId } : {}),
      role: { accountOwnerId, ...ACTIVE_WHERE },
      user: {
        status: { gte: AccountStatus.DISABLED },
        OR: [{ id: accountOwnerId }, { accountOwnerId }, { accountOwnerId: null, parentUserId: accountOwnerId }],
      },
    };
    const groupWhere: Prisma.RamGroupRoleBindingWhereInput = {
      accountOwnerId,
      roleId,
      ...ACTIVE_WHERE,
      ...(target ? { groupId: target.groupId ?? "" } : {}),
      role: { accountOwnerId, ...ACTIVE_WHERE },
      group: { accountOwnerId, ...ACTIVE_WHERE },
    };
    const userCount = await prisma.ramUserRoleBinding.count({ where: userWhere });
    const users =
      skip < userCount
        ? await prisma.ramUserRoleBinding.findMany({
            where: userWhere,
            include: { role: true },
            skip,
            take: pageSize + 1,
            orderBy: [{ createTime: "desc" }, { id: "asc" }],
          })
        : [];
    const remaining = pageSize + 1 - users.length;
    const groups =
      remaining > 0
        ? await prisma.ramGroupRoleBinding.findMany({
            where: groupWhere,
            include: { role: true },
            skip: Math.max(0, skip - userCount),
            take: remaining,
            orderBy: [{ createTime: "desc" }, { id: "asc" }],
          })
        : [];
    const candidates: RamRoleBindingRecord[] = [
      ...users.map((binding) => ({
        id: binding.id,
        roleId,
        roleName: binding.role.name,
        permissions: [],
        source: "user" as const,
        principalId: binding.userId,
      })),
      ...groups.map((binding) => ({
        id: binding.id,
        roleId,
        roleName: binding.role.name,
        permissions: [],
        source: "group" as const,
        principalId: binding.groupId,
      })),
    ];
    return { items: candidates.slice(0, pageSize), page, pageSize, hasNext: candidates.length > pageSize };
  }

  async createRoleSession(data: {
    accountOwnerId: string;
    subjectUserId: string;
    roleId: string;
    sessionName: string;
    expiresAt: Date;
    expectedRoleUpdateTime?: Date;
  }): Promise<ActiveRamRoleSession> {
    return prisma.$transaction(
      async (tx) => {
        const role = await tx.ramRole.findFirst({
          where: {
            id: data.roleId,
            accountOwnerId: data.accountOwnerId,
            status: AccountStatus.ACTIVE,
            ...(data.expectedRoleUpdateTime ? { updateTime: data.expectedRoleUpdateTime } : {}),
          },
        });
        if (!role)
          throw new ConflictError("Role changed during assumption", undefined, { messageKey: "iam.versionConflict" });
        return tx.ramRoleSession.create({
          data: {
            accountOwnerId: data.accountOwnerId,
            subjectUserId: data.subjectUserId,
            roleId: data.roleId,
            sessionName: data.sessionName,
            expiresAt: data.expiresAt,
            status: AccountStatus.ACTIVE,
          },
          include: { role: true },
        });
      },
      { isolationLevel: "Serializable" },
    );
  }

  async findActiveRoleSession(sessionId: string): Promise<ActiveRamRoleSession | null> {
    return prisma.ramRoleSession.findFirst({
      where: { id: sessionId, status: AccountStatus.ACTIVE, expiresAt: { gt: new Date() } },
      include: { role: true },
    });
  }

  async revokeRoleSession(sessionId: string): Promise<RamRoleSession> {
    return prisma.ramRoleSession.update({ where: { id: sessionId }, data: { status: AccountStatus.DISABLED } });
  }

  async listActiveRoleSessions(accountOwnerId: string, subjectUserId?: string): Promise<ActiveRamRoleSession[]> {
    return prisma.ramRoleSession.findMany({
      where: {
        accountOwnerId,
        subjectUserId,
        status: AccountStatus.ACTIVE,
        expiresAt: { gt: new Date() },
      },
      include: { role: true },
      orderBy: { createTime: "desc" },
    });
  }
  async listActiveRoleSessionsPage(accountOwnerId: string, pagination: IamManagementPage, subjectUserId?: string) {
    const candidates = await prisma.ramRoleSession.findMany({
      where: {
        accountOwnerId,
        subjectUserId,
        status: AccountStatus.ACTIVE,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        role: { accountOwnerId },
        subjectUser: {
          status: { gte: AccountStatus.DISABLED },
          OR: [{ id: accountOwnerId }, { accountOwnerId }, { accountOwnerId: null, parentUserId: accountOwnerId }],
        },
      },
      include: { role: true },
      orderBy: [{ createTime: "desc" }, { id: "asc" }],
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize + 1,
    });
    return {
      items: candidates.slice(0, pagination.pageSize),
      ...pagination,
      hasNext: candidates.length > pagination.pageSize,
    };
  }
}
