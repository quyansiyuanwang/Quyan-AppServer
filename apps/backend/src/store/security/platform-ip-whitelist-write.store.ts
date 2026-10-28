import type { IPWhiteList } from "@prisma/client";
import type { Permission, IamPrincipal } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
export type IpWhitelistWriteTarget = Pick<IPWhiteList, "id" | "ipAddress" | "status" | "updateTime">;
export interface PlatformIpWhitelistWriteGuard {
  permission: Permission;
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
  recheckEntry: (id: string) => Promise<void>;
}
export interface PlatformIpWhitelistWriteStore {
  target(principal: IamPrincipal, ip: string): Promise<IpWhitelistWriteTarget | null>;
  create(
    input: { ipAddress: string; reason: string; expiresAt?: Date },
    guard: PlatformIpWhitelistWriteGuard,
  ): Promise<IPWhiteList>;
  remove(target: IpWhitelistWriteTarget, guard: PlatformIpWhitelistWriteGuard): Promise<boolean>;
}
