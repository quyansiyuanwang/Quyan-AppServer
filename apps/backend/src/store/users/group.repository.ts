import { prisma } from "@/config/database";
import { Prisma, type Group } from "@prisma/client";
import type {
  GroupStore,
  GroupWithUserCount,
  GroupListFilters,
  PaginatedGroupListFilters,
  GroupPermissionSnapshot,
} from "./group.store";
import { RECORD_STATUS } from "@/constant/status";
import { Permission } from "@/constant/permission";

const RAM_PERMISSION_VALUES = Object.values(Permission).filter((p) => p.startsWith("ram:"));

export class GroupRepository implements GroupStore {
  private static instance: GroupRepository;

  public static getInstance(): GroupRepository {
    if (!GroupRepository.instance) GroupRepository.instance = new GroupRepository();

    return GroupRepository.instance;
  }

  private userCountInclude(accountOwnerId?: string) {
    return {
      _count: {
        select: { users: accountOwnerId ? { where: { OR: [{ accountOwnerId }, { id: accountOwnerId }] } } : true },
      },
    } as const;
  }

  private buildActiveWhere(filters: GroupListFilters = {}): Prisma.GroupWhereInput {
    const where: Prisma.GroupWhereInput = { status: RECORD_STATUS.ACTIVE };

    const keyword = filters.keyword?.trim();
    if (keyword) where.OR = [{ name: { contains: keyword } }, { username: { contains: keyword } }];

    if (filters.hasRamPermission) {
      const permConditions = RAM_PERMISSION_VALUES.map((p) => ({
        permissions: { array_contains: p },
      }));
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: permConditions }];
        delete where.OR;
      } else where.OR = permConditions;
    }

    if (filters.minLevel !== undefined) where.level = { gte: filters.minLevel };

    if (filters.accountOwnerId) {
      const accountScope: Prisma.GroupWhereInput = filters.recoveryGroupId
        ? { OR: [{ accountOwnerId: filters.accountOwnerId }, { id: filters.recoveryGroupId, accountOwnerId: null }] }
        : { accountOwnerId: filters.accountOwnerId };
      const currentAnd = where.AND;
      where.AND = [...(Array.isArray(currentAnd) ? currentAnd : currentAnd ? [currentAnd] : []), accountScope];
    }
    return where;
  }

  async findById(id: string): Promise<Group | null> {
    return prisma.group.findUnique({ where: { id } });
  }

  async findByIds(ids: string[]): Promise<Group[]> {
    if (ids.length === 0) return [];

    return prisma.group.findMany({
      where: {
        id: {
          in: ids,
        },
      },
    });
  }

  async findByIdWithUserCount(id: string, accountOwnerId?: string): Promise<GroupWithUserCount | null> {
    return prisma.group.findUnique({
      where: { id },
      include: this.userCountInclude(accountOwnerId),
    });
  }

  async findByUsername(username: string): Promise<Group | null> {
    return prisma.group.findFirst({
      where: {
        username,
        status: RECORD_STATUS.ACTIVE,
      },
    });
  }

  async findActiveByUsername(username: string): Promise<Group | null> {
    return prisma.group.findFirst({
      where: {
        username,
        status: RECORD_STATUS.ACTIVE,
      },
    });
  }

  async findDefaultUserGroup(): Promise<Group | null> {
    return prisma.group.findFirst({
      where: {
        username: "user",
        status: RECORD_STATUS.ACTIVE,
      },
    });
  }

  async findRamDefaultGroup(): Promise<Group | null> {
    return prisma.group.findFirst({
      where: {
        username: "ram-default",
        status: RECORD_STATUS.ACTIVE,
      },
    });
  }

  async listActiveWithUserCount(): Promise<GroupWithUserCount[]> {
    return prisma.group.findMany({
      where: { status: RECORD_STATUS.ACTIVE },
      include: { _count: { select: { users: true } } },
    });
  }

  async listVisibleWithUserCount(minLevel: number): Promise<GroupWithUserCount[]> {
    return prisma.group.findMany({
      where: {
        status: RECORD_STATUS.ACTIVE,
        level: { gte: minLevel },
      },
      include: { _count: { select: { users: true } } },
    });
  }

  async listActiveWithUserCountPaginated(params: PaginatedGroupListFilters): Promise<GroupWithUserCount[]> {
    const { skip, take, ...filters } = params;

    return prisma.group.findMany({
      where: this.buildActiveWhere(filters),
      include: this.userCountInclude(filters.accountOwnerId),
      skip,
      take,
      orderBy: [{ level: "desc" }, { createTime: "desc" }, { id: "asc" }],
    });
  }

  async countActiveFiltered(filters: GroupListFilters): Promise<number> {
    return prisma.group.count({
      where: this.buildActiveWhere(filters),
    });
  }

  async createWithUserCount(data: Prisma.GroupUncheckedCreateInput): Promise<GroupWithUserCount> {
    return prisma.group.create({
      data,
      include: { _count: { select: { users: true } } },
    });
  }

  async countAll(): Promise<number> {
    return prisma.group.count();
  }

  async compareAndSetPermissions(expected: GroupPermissionSnapshot, permissions: string[]): Promise<boolean> {
    const result = await prisma.group.updateMany({
      where: {
        id: expected.id,
        updateTime: expected.updateTime,
        accountOwnerId: expected.accountOwnerId,
        status: expected.status,
        level: expected.level,
        username: expected.username,
        permissions: { equals: expected.permissions ?? Prisma.JsonNull },
      },
      data: {
        permissions,
        updateTime: new Date(Math.max(Date.now(), expected.updateTime.getTime() + 1)),
      },
    });
    return result.count === 1;
  }

  async updateById(id: string, data: Prisma.GroupUncheckedUpdateInput): Promise<Group> {
    return prisma.group.update({
      where: { id },
      data,
    });
  }

  async updateWithUserCount(
    id: string,
    data: Prisma.GroupUncheckedUpdateInput,
    accountOwnerId?: string,
  ): Promise<GroupWithUserCount> {
    return prisma.group.update({
      where: { id },
      data,
      include: this.userCountInclude(accountOwnerId),
    });
  }

  async softDelete(id: string): Promise<Group> {
    const group = await this.findById(id);
    if (!group) throw new Error("Group not found");
    const deletedUsername = `${group.username}_del_${Date.now()}`;
    return this.updateById(id, { username: deletedUsername, status: RECORD_STATUS.DELETED });
  }
}
