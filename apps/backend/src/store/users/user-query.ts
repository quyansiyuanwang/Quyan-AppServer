import type { Prisma } from "@prisma/client";
import { Permission } from "@/constant/permission";
import { AccountStatus } from "@/util/auth/account-status";
import type { UserListFilters } from "./user.store";
const RAM_PERMISSION_VALUES = Object.values(Permission).filter((permission) => permission.startsWith("ram:"));
export function buildNonDeletedUserWhere(filters: UserListFilters = {}, minGroupLevel?: number): Prisma.UserWhereInput {
  const keyword = filters.keyword?.trim();
  const userId = filters.userId?.trim();
  const groupId = filters.groupId?.trim();
  const excludeUserType = filters.excludeUserType?.trim();
  const userType = filters.userType?.trim();

  const andConditions: Prisma.UserWhereInput[] = [];
  if (filters.accountOwnerId)
    andConditions.push({
      OR: [{ accountOwnerId: filters.accountOwnerId }, { accountOwnerId: null, parentUserId: filters.accountOwnerId }],
    });

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
