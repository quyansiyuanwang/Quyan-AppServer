import type { IamPrincipal } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
export type SupportConfigAction = "quyan:support:GetConfig" | "quyan:support:UpdateConfig";
export interface SupportConfigSnapshot {
  id: string;
  key: string;
  status: number;
  value: string;
  updateTime: Date;
}
export interface SupportConfigGuard {
  action: SupportConfigAction;
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
  configs: readonly SupportConfigSnapshot[];
}
export interface SupportConfigStore {
  groupSnapshot(principal: IamPrincipal): Promise<{ id: string; updateTime: Date }>;
  snapshot(principal: IamPrincipal): Promise<SupportConfigSnapshot[]>;
  recheck(guard: SupportConfigGuard): Promise<void>;
  update(updates: Readonly<Record<string, string>>, guard: SupportConfigGuard): Promise<Record<string, string>>;
}
