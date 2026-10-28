import type { IPBlackList } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
export type IpBlacklistMutationTarget = Pick<IPBlackList, "id" | "ipAddress" | "status" | "updateTime">;
export type IpBlacklistMutationAction =
  | "quyan:system:ip_blacklist:CreateBlacklist"
  | "quyan:system:ip_blacklist:UpdateBlacklist"
  | "quyan:system:ip_blacklist:DeleteBlacklist";
export interface IpBlacklistMutationGuard {
  action: IpBlacklistMutationAction;
  authorizationRevision: string;
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
}
export interface IpBlacklistUpdateInput {
  reason?: string;
  expireTime?: Date;
}
export interface IpBlacklistCreateInput {
  ipAddress: string;
  reason: string;
  expireTime: Date;
}
export interface PlatformIpBlacklistMutationStore {
  create(
    target: IpBlacklistMutationTarget | null,
    input: IpBlacklistCreateInput,
    guard: IpBlacklistMutationGuard,
  ): Promise<IPBlackList>;
  remove(target: IpBlacklistMutationTarget, guard: IpBlacklistMutationGuard): Promise<boolean>;
  authorizationRevision(principal: IamPrincipal): Promise<string>;
  target(ip: string): Promise<IpBlacklistMutationTarget | null>;
  update(
    target: IpBlacklistMutationTarget,
    input: IpBlacklistUpdateInput,
    guard: IpBlacklistMutationGuard,
  ): Promise<IPBlackList>;
}
