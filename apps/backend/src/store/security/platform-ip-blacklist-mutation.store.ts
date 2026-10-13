import type { IPBlackList } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
export type IpBlacklistMutationTarget = Pick<IPBlackList, "id" | "ipAddress" | "status" | "updateTime">;
export interface IpBlacklistMutationGuard {
  authorizationRevision: string;
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
}
export interface IpBlacklistUpdateInput {
  reason?: string;
  expireTime?: Date;
}
export interface PlatformIpBlacklistMutationStore {
  authorizationRevision(principal: IamPrincipal): Promise<string>;
  target(ip: string): Promise<IpBlacklistMutationTarget | null>;
  update(
    target: IpBlacklistMutationTarget,
    input: IpBlacklistUpdateInput,
    guard: IpBlacklistMutationGuard,
  ): Promise<IPBlackList>;
}
