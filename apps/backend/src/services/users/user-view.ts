import type { User, Group } from "@prisma/client";
import type { UserDto } from "@/api/dto/users/user.dto";
export type UserViewEntity = Pick<
  User,
  "id" | "username" | "email" | "name" | "status" | "accountOwnerId" | "groupId" | "createTime" | "updateTime"
>;
export function userViewDto(
  user: UserViewEntity,
  balanceAccount: { balance: unknown } | null | undefined,
  group: Pick<Group, "name" | "username"> | null | undefined,
): UserDto {
  return {
    id: user.id,
    accountOwnerId: user.accountOwnerId || user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    status: user.status,
    groupId: user.groupId ?? undefined,
    groupName: group?.name || group?.username || null,
    balance: balanceAccount ? Number(balanceAccount.balance) : 0,
    createdAt: user.createTime.toISOString(),
    updatedAt: user.updateTime.toISOString(),
  };
}
