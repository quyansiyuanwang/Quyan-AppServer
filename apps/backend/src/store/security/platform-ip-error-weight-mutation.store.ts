import type { IamPrincipal } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
export type IpErrorWeightAction =
  | "quyan:system:ip_blacklist:SetIPAddressErrorWeight"
  | "quyan:system:ip_blacklist:ResetIPAddressErrorWeight";
export interface IpErrorWeightMutationGuard {
  action: IpErrorWeightAction;
  ipAddress: string;
  authorizationRevision: string;
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
}
export interface PlatformIpErrorWeightMutationStore {
  authorizationRevision(principal: IamPrincipal): Promise<string>;
  admit(guard: IpErrorWeightMutationGuard, effect: () => Promise<void>): Promise<void>;
}
