import type { Group, Prisma } from "@prisma/client";

export type GroupWithUserCount = Prisma.GroupGetPayload<{
  include: { _count: { select: { users: true } } };
}>;

export interface GroupListFilters {
  keyword?: string;
  hasRamPermission?: boolean;
  minLevel?: number;
  accountOwnerId?: string;
  recoveryGroupId?: string;
}

export interface PaginatedGroupListFilters extends GroupListFilters {
  skip: number;
  take: number;
}

export interface GroupQueryStore {
  findById(id: string): Promise<Group | null>;
  findByIds(ids: string[]): Promise<Group[]>;
  findByIdWithUserCount(id: string, accountOwnerId?: string): Promise<GroupWithUserCount | null>;
  findByUsername(username: string): Promise<Group | null>;
  findActiveByUsername(username: string): Promise<Group | null>;
  findDefaultUserGroup(): Promise<Group | null>;
  findRamDefaultGroup(): Promise<Group | null>;
  listActiveWithUserCount(): Promise<GroupWithUserCount[]>;
  listVisibleWithUserCount(minLevel: number): Promise<GroupWithUserCount[]>;
  listActiveWithUserCountPaginated(params: PaginatedGroupListFilters): Promise<GroupWithUserCount[]>;
  countActiveFiltered(filters: GroupListFilters): Promise<number>;
  countAll(): Promise<number>;
}

/** Server-owned state shared by diff authorization and the conditional write. */
export type GroupPermissionSnapshot = Pick<
  Group,
  "id" | "updateTime" | "accountOwnerId" | "status" | "level" | "username" | "name" | "permissions"
>;

export interface GroupMutationStore {
  createWithUserCount(data: Prisma.GroupUncheckedCreateInput): Promise<GroupWithUserCount>;
  updateById(id: string, data: Prisma.GroupUncheckedUpdateInput): Promise<Group>;
  updateWithUserCount(
    id: string,
    data: Prisma.GroupUncheckedUpdateInput,
    accountOwnerId?: string,
  ): Promise<GroupWithUserCount>;
  compareAndSetPermissions(expected: GroupPermissionSnapshot, permissions: string[]): Promise<boolean>;
  softDelete(id: string): Promise<Group>;
}

export type GroupStore = GroupQueryStore & GroupMutationStore;
