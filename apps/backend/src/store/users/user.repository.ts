import { buildNonDeletedUserWhere } from "./user-query";
import { prisma } from "@/config/database";
import { Prisma, type User, type BalanceAccount } from "@prisma/client";
import type {
  UserStore,
  UserWithGroup,
  UserListFilters,
  PaginatedUserListFilters,
  UserPermissionSnapshot,
} from "./user.store";
import { AccountStatus } from "@/util/auth/account-status";

export class UserRepository implements UserStore {
  private static instance: UserRepository;

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

  async findAccountIdentity(id: string) {
    return prisma.user.findUnique({ where: { id }, select: { id: true, status: true, accountOwnerId: true } });
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
      where: buildNonDeletedUserWhere(),
      orderBy: this.getUserListOrderBy(),
    });
  }

  async listNonDeletedPaginated(params: PaginatedUserListFilters): Promise<User[]> {
    const { skip, take, ...filters } = params;

    return prisma.user.findMany({
      where: buildNonDeletedUserWhere(filters),
      orderBy: this.getUserListOrderBy(),
      skip,
      take,
    });
  }

  async countNonDeletedFiltered(filters: UserListFilters): Promise<number> {
    return prisma.user.count({
      where: buildNonDeletedUserWhere(filters),
    });
  }

  async listNonDeletedByGroupLevelGte(level: number): Promise<User[]> {
    return prisma.user.findMany({
      where: buildNonDeletedUserWhere({}, level),
      orderBy: this.getUserListOrderBy(),
    });
  }

  async listNonDeletedByGroupLevelGtePaginated(level: number, params: PaginatedUserListFilters): Promise<User[]> {
    const { skip, take, ...filters } = params;

    return prisma.user.findMany({
      where: buildNonDeletedUserWhere(filters, level),
      orderBy: this.getUserListOrderBy(),
      skip,
      take,
    });
  }

  async countNonDeletedByGroupLevelGte(level: number, filters: UserListFilters): Promise<number> {
    return prisma.user.count({
      where: buildNonDeletedUserWhere(filters, level),
    });
  }

  async create(data: Prisma.UserUncheckedCreateInput): Promise<User> {
    return prisma.user.create({ data });
  }

  async countAll(): Promise<number> {
    return prisma.user.count();
  }

  async compareAndSetPermissions(
    expected: UserPermissionSnapshot,
    data: { permissionAdds?: string[]; permissionRemoves?: string[] },
  ): Promise<boolean> {
    const result = await prisma.user.updateMany({
      where: {
        id: expected.id,
        updateTime: expected.updateTime,
        accountOwnerId: expected.accountOwnerId,
        parentUserId: expected.parentUserId,
        groupId: expected.groupId,
        userType: expected.userType,
        status: expected.status,
        permissionAdds: { equals: expected.permissionAdds ?? Prisma.JsonNull },
        permissionRemoves: { equals: expected.permissionRemoves ?? Prisma.JsonNull },
        group: expected.group
          ? {
              is: {
                id: expected.group.id,
                updateTime: expected.group.updateTime,
                level: expected.group.level,
                status: expected.group.status,
                accountOwnerId: expected.group.accountOwnerId,
              },
            }
          : null,
      },
      data: {
        ...data,
        // Guarantee that even same-millisecond competing writes cannot reuse a snapshot.
        updateTime: new Date(Math.max(Date.now(), expected.updateTime.getTime() + 1)),
      },
    });
    return result.count === 1;
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
