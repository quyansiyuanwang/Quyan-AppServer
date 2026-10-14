import type { IamPrincipal, Permission } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
export interface ConfigurationTarget {
  id: string;
  key: string;
  status: number;
  updateTime: Date;
}
export interface ConfigurationView extends ConfigurationTarget {
  value: string;
}
export type PlatformConfigurationAction = "quyan:system:ListConfigurations" | "quyan:system:UpdateConfigurations";
export interface PlatformConfigurationGuard {
  action: PlatformConfigurationAction;
  keys: readonly string[];
  targets: readonly ConfigurationTarget[];
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
}
export interface PlatformConfigurationStore {
  groupSnapshot(
    principal: IamPrincipal,
    permission?: Permission.SYSTEM_CONFIG | Permission.TICKET_REVIEW_UPDATE,
  ): Promise<{ id: string; updateTime: Date }>;
  scan(principal: IamPrincipal, after?: string): Promise<ConfigurationTarget[]>;
  targets(principal: IamPrincipal, keys: readonly string[]): Promise<ConfigurationTarget[]>;
  hydrate(principal: IamPrincipal, targets: readonly ConfigurationTarget[]): Promise<ConfigurationView[]>;
  recheck(guard: PlatformConfigurationGuard): Promise<void>;
  update(updates: Readonly<Record<string, string>>, guard: PlatformConfigurationGuard): Promise<ConfigurationView[]>;
}
