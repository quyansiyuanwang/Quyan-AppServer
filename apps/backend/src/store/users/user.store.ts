import type { BalanceAccount, Prisma, User } from "@prisma/client";

export interface UserListFilters {
  keyword?: string;
  userId?: string;
  groupId?: string;
  excludeUserId?: string;
  excludeUserType?: string;
  userType?: string;
  hasRamPermission?: boolean;
}

export interface PaginatedUserListFilters extends UserListFilters {
  skip: number;
  take: number;
}

export type UserWithGroup = Prisma.UserGetPayload<{
  include: { group: true };
}>;

export interface UserQueryStore {
  findById(id: string): Promise<User | null>;
  findActiveById(id: string): Promise<User | null>;
  findByIdWithGroup(id: string): Promise<UserWithGroup | null>;
  findByUsername(username: string): Promise<User | null>;
  countActiveByEmail(email: string): Promise<number>;
  findByEmailInNonDeleted(email: string): Promise<User | null>;
  findActiveByUsernameAndEmail(username: string, email: string): Promise<User | null>;
  findByUsernameAndEmailInNonDeleted(username: string, email: string): Promise<User | null>;
  listNonDeleted(): Promise<User[]>;
  listNonDeletedPaginated(params: PaginatedUserListFilters): Promise<User[]>;
  countNonDeletedFiltered(filters: UserListFilters): Promise<number>;
  listNonDeletedByGroupLevelGte(level: number): Promise<User[]>;
  listNonDeletedByGroupLevelGtePaginated(level: number, params: PaginatedUserListFilters): Promise<User[]>;
  countNonDeletedByGroupLevelGte(level: number, filters: UserListFilters): Promise<number>;
  countAll(): Promise<number>;
  findBalanceAccountByUserId(userId: string): Promise<BalanceAccount | null>;
  findBalanceAccountsByUserIds(userIds: string[]): Promise<BalanceAccount[]>;
  findUsernamesByIds(ids: string[]): Promise<Array<{ id: string; username: string }>>;
  findActiveUsernameById(id: string): Promise<string | null>;
}

export interface UserMutationStore {
  create(data: Prisma.UserUncheckedCreateInput): Promise<User>;
  updateById(id: string, data: Prisma.UserUncheckedUpdateInput): Promise<User>;
  softDelete(id: string): Promise<User>;
}

export type UserStore = UserQueryStore & UserMutationStore;
