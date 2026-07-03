import { prisma } from "@/config/database";
import type { Group, Prisma } from "@prisma/client";
import type { GroupStore, GroupWithUserCount, GroupListFilters, PaginatedGroupListFilters } from "./group.store";
import { RECORD_STATUS } from "@/constant/status";
import { Permission } from "@/constant/permission";

const RAM_PERMISSION_VALUES = Object.values(Permission).filter((p) => p.startsWith("ram:"));

export class GroupRepository implements GroupStore {
  private static instance: GroupRepository;

  public static getInstance(): GroupRepository {
    if (!GroupRepository.instance) GroupRepository.instance = new GroupRepository();

    return GroupRepository.instance;
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

  async findByIdWithUserCount(id: string): Promise<GroupWithUserCount | null> {
    return prisma.group.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
  }

  async findByUsername(username: string): Promise<Group | null> {
    return prisma.group.findUnique({ where: { username } });
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
      include: { _count: { select: { users: true } } },
      skip,
      take,
      orderBy: [{ level: "desc" }, { createTime: "desc" }],
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

  async updateById(id: string, data: Prisma.GroupUncheckedUpdateInput): Promise<Group> {
    return prisma.group.update({
      where: { id },
      data,
    });
  }

  async updateWithUserCount(id: string, data: Prisma.GroupUncheckedUpdateInput): Promise<GroupWithUserCount> {
    return prisma.group.update({
      where: { id },
      data,
      include: { _count: { select: { users: true } } },
    });
  }

  async softDelete(id: string): Promise<Group> {
    return this.updateById(id, { status: RECORD_STATUS.DELETED });
  }
}
