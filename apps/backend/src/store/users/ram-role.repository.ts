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

function normalizePermissions(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

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
        permissions: data.permissions,
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

  async updateRole(roleId: string, data: UpdateRamRoleInput): Promise<RamRole> {
    const updateData: Prisma.RamRoleUncheckedUpdateInput = {};
    if (data.description !== undefined) updateData.description = data.description;
    if (data.permissions !== undefined) updateData.permissions = data.permissions;
    if (data.trustPolicy !== undefined)
      updateData.trustPolicy =
        data.trustPolicy === null ? Prisma.JsonNull : (data.trustPolicy as Prisma.InputJsonValue);
    if (data.maxSessionDuration !== undefined) updateData.maxSessionDuration = data.maxSessionDuration;
    if (data.status !== undefined) updateData.status = data.status;

    return prisma.ramRole.update({ where: { id: roleId }, data: updateData });
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

  async listRoleBindingsForUser(userId: string, groupId?: string | null): Promise<RamRoleBindingRecord[]> {
    const [userBindings, groupBindings] = await Promise.all([
      prisma.ramUserRoleBinding.findMany({
        where: { userId, role: ACTIVE_WHERE },
        include: { role: true },
      }),
      groupId
        ? prisma.ramGroupRoleBinding.findMany({
          where: { groupId, role: ACTIVE_WHERE },
          include: { role: true },
        })
        : Promise.resolve([]),
    ]);

    return [
      ...userBindings.map((binding) => ({
        id: binding.id,
        roleId: binding.roleId,
        roleName: binding.role.name,
        permissions: normalizePermissions(binding.role.permissions),
        source: "user" as const,
        principalId: binding.userId,
      })),
      ...groupBindings.map((binding) => ({
        id: binding.id,
        roleId: binding.roleId,
        roleName: binding.role.name,
        permissions: normalizePermissions(binding.role.permissions),
        source: "group" as const,
        principalId: binding.groupId,
      })),
    ];
  }

  async listRoleBindingsByRole(roleId: string): Promise<RamRoleWithBindings | null> {
    return prisma.ramRole.findFirst({
      where: { id: roleId, ...ACTIVE_WHERE },
      include: { userBindings: true, groupBindings: true },
    });
  }

  async createRoleSession(data: {
    accountOwnerId: string;
    subjectUserId: string;
    roleId: string;
    sessionName: string;
    expiresAt: Date;
  }): Promise<ActiveRamRoleSession> {
    return prisma.ramRoleSession.create({
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
}
