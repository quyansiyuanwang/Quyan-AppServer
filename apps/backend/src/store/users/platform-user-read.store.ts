import type { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import type { PlatformCollectionTarget, PlatformCollectionCursor } from "../system/platform-collection.store";
import type { UserListFilters } from "./user.store";
export interface PlatformUserReadTarget extends PlatformCollectionTarget {
  revision: string;
}
export interface PlatformUserReadWhere {
  level: number;
  query: Prisma.UserWhereInput;
}
export const PLATFORM_USER_VIEW_SELECT = {
  id: true,
  status: true,
  username: true,
  name: true,
  email: true,
  accountOwnerId: true,
  groupId: true,
  createTime: true,
  updateTime: true,
  group: { select: { name: true, username: true } },
  balanceAccount: { select: { balance: true } },
} as const;
export type PlatformUserReadView = Prisma.UserGetPayload<{ select: typeof PLATFORM_USER_VIEW_SELECT }>;
export interface PlatformUserReadStore {
  where(principal: IamPrincipal, filters: UserListFilters): Promise<PlatformUserReadWhere>;
  scan(
    principal: IamPrincipal,
    where: PlatformUserReadWhere,
    after?: PlatformCollectionCursor,
    boundary?: PlatformCollectionCursor,
  ): Promise<PlatformUserReadTarget[]>;
  target(principal: IamPrincipal, id: string): Promise<PlatformUserReadTarget | null>;
  recheck(principal: IamPrincipal, expected: readonly PlatformUserReadTarget[]): Promise<void>;
  hydrate(principal: IamPrincipal, expected: readonly PlatformUserReadTarget[]): Promise<PlatformUserReadView[]>;
}
