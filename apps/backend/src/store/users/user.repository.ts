import { prisma } from "@/config/database";
import type { Prisma, User, BalanceAccount } from "@prisma/client";
import type { UserStore, UserWithGroup, UserListFilters, PaginatedUserListFilters } from "./user.store";
import { AccountStatus } from "@/util/auth/account-status";
import { Permission } from "@/constant/permission";

const RAM_PERMISSION_VALUES = Object.values(Permission).filter((p) => p.startsWith("ram:"));

export class UserRepository implements UserStore {
  private static instance: UserRepository;

  private buildNonDeletedWhere(filters: UserListFilters = {}, minGroupLevel?: number): Prisma.UserWhereInput {
    const keyword = filters.keyword?.trim();
    const userId = filters.userId?.trim();
    const groupId = filters.groupId?.trim();
    const excludeUserType = filters.excludeUserType?.trim();
    const userType = filters.userType?.trim();

    const andConditions: Prisma.UserWhereInput[] = [];

    if (keyword)
      andConditions.push({
        OR: [
          { id: { contains: keyword } },
          { username: { contains: keyword } },
          { email: { contains: keyword } },
          { name: { contains: keyword } },
        ],
      });

    // hasRamPermission: user's permissionAdds or group's permissions contains any ram:* permission
    if (filters.hasRamPermission) {
      const permConditions: Prisma.UserWhereInput[] = [
        ...RAM_PERMISSION_VALUES.map((p) => ({
          permissionAdds: { array_contains: p },
        })),
        ...RAM_PERMISSION_VALUES.map((p) => ({
          group: { permissions: { array_contains: p } },
        })),
      ];
      andConditions.push({ OR: permConditions });
    }

    return {
      status: {
        gte: AccountStatus.DISABLED,
      },
      ...(minGroupLevel !== undefined
        ? {
            group: {
              level: {
                gte: minGroupLevel,
              },
            },
          }
        : {}),
      ...(excludeUserType && !userType
        ? {
            userType: {
              not: excludeUserType,
            },
          }
        : {}),
      ...(userType
        ? {
            userType,
          }
        : {}),
      ...(filters.excludeUserId
        ? {
            id: {
              not: filters.excludeUserId,
            },
          }
        : {}),
      ...(userId
        ? {
            id: {
              contains: userId,
            },
          }
        : {}),
      ...(groupId
        ? {
            groupId,
          }
        : {}),
      ...(andConditions.length > 0
        ? {
            AND: andConditions,
          }
        : {}),
    };
  }

  private getUserListOrderBy(): Prisma.UserOrderByWithRelationInput[] {
    return [{ createTime: "desc" }, { id: "desc" }];
  }

  public static getInstance(): UserRepository {
    if (!UserRepository.instance) UserRepository.instance = new UserRepository();

    return UserRepository.instance;
  }

  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  }

  async findActiveById(id: string): Promise<User | null> {
    return prisma.user.findFirst({
      where: {
        id,
        status: AccountStatus.ACTIVE,
      },
    });
  }

  async findByIdWithGroup(id: string): Promise<UserWithGroup | null> {
    return prisma.user.findUnique({
      where: { id },
      include: { group: true },
    });
  }

  async findByUsername(username: string): Promise<User | null> {
    return prisma.user.findFirst({
      where: {
        username,
        status: AccountStatus.ACTIVE,
      },
    });
  }

  async countActiveByEmail(email: string): Promise<number> {
    return prisma.user.count({
      where: {
        email,
        status: AccountStatus.ACTIVE,
      },
    });
  }

  async findByEmailInNonDeleted(email: string): Promise<User | null> {
    return prisma.user.findFirst({
      where: {
        email,
        status: { gte: AccountStatus.DISABLED },
      },
    });
  }

  async findActiveByUsernameAndEmail(username: string, email: string): Promise<User | null> {
    return prisma.user.findFirst({
      where: {
        username,
        email,
        status: AccountStatus.ACTIVE,
      },
    });
  }

  async findByUsernameAndEmailInNonDeleted(username: string, email: string): Promise<User | null> {
    return this.findActiveByUsernameAndEmail(username, email);
  }

  async listNonDeleted(): Promise<User[]> {
    return prisma.user.findMany({
      where: this.buildNonDeletedWhere(),
      orderBy: this.getUserListOrderBy(),
    });
  }

  async listNonDeletedPaginated(params: PaginatedUserListFilters): Promise<User[]> {
    const { skip, take, ...filters } = params;

    return prisma.user.findMany({
      where: this.buildNonDeletedWhere(filters),
      orderBy: this.getUserListOrderBy(),
      skip,
      take,
    });
  }

  async countNonDeletedFiltered(filters: UserListFilters): Promise<number> {
    return prisma.user.count({
      where: this.buildNonDeletedWhere(filters),
    });
  }

  async listNonDeletedByGroupLevelGte(level: number): Promise<User[]> {
    return prisma.user.findMany({
      where: this.buildNonDeletedWhere({}, level),
      orderBy: this.getUserListOrderBy(),
    });
  }

  async listNonDeletedByGroupLevelGtePaginated(level: number, params: PaginatedUserListFilters): Promise<User[]> {
    const { skip, take, ...filters } = params;

    return prisma.user.findMany({
      where: this.buildNonDeletedWhere(filters, level),
      orderBy: this.getUserListOrderBy(),
      skip,
      take,
    });
  }

  async countNonDeletedByGroupLevelGte(level: number, filters: UserListFilters): Promise<number> {
    return prisma.user.count({
      where: this.buildNonDeletedWhere(filters, level),
    });
  }

  async create(data: Prisma.UserUncheckedCreateInput): Promise<User> {
    return prisma.user.create({ data });
  }

  async countAll(): Promise<number> {
    return prisma.user.count();
  }

  async updateById(id: string, data: Prisma.UserUncheckedUpdateInput): Promise<User> {
    return prisma.user.update({
      where: { id },
      data,
    });
  }

  async softDelete(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw new Error("User not found");
    const deletedUsername = `${user.username}_del_${Date.now()}`;
    return this.updateById(id, { username: deletedUsername, status: AccountStatus.DELETED });
  }

  async findBalanceAccountByUserId(userId: string): Promise<BalanceAccount | null> {
    return prisma.balanceAccount.findUnique({ where: { userId } });
  }

  async findBalanceAccountsByUserIds(userIds: string[]): Promise<BalanceAccount[]> {
    if (userIds.length === 0) return [];

    return prisma.balanceAccount.findMany({
      where: {
        userId: {
          in: userIds,
        },
      },
    });
  }

  async findUsernamesByIds(ids: string[]): Promise<Array<{ id: string; username: string }>> {
    if (ids.length === 0) return [];

    return prisma.user.findMany({
      where: {
        id: { in: ids },
        status: AccountStatus.ACTIVE,
      },
      select: {
        id: true,
        username: true,
      },
    });
  }

  async findActiveUsernameById(id: string): Promise<string | null> {
    const user = await prisma.user.findFirst({
      where: {
        id,
        status: AccountStatus.ACTIVE,
      },
      select: {
        username: true,
      },
    });

    return user?.username ?? null;
  }
}
