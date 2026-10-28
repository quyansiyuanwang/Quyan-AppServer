import type { OAuthClientTarget, OAuthClientView } from "./oauth-client-management.store";
import type { OAuthClientCreateInput, OAuthClientUpdateInput } from "./oauth-client.store";
import type { IamAccountUserMutationGuard } from "./iam-account-user-mutation";
export interface PlatformOAuthClientMutationGuard {
  target: OAuthClientTarget;
  users: IamAccountUserMutationGuard;
  group: { id: string; updateTime: Date };
  scopeCheck?: () => Promise<void>;
}
export type PlatformOAuthClientCreateGuard = Omit<PlatformOAuthClientMutationGuard, "target" | "scopeCheck"> & {
  scopeCheck: () => Promise<void>;
};
export interface PlatformOAuthClientMutationStore {
  create(data: OAuthClientCreateInput, guard: PlatformOAuthClientCreateGuard): Promise<OAuthClientView>;
  update(data: OAuthClientUpdateInput, guard: PlatformOAuthClientMutationGuard): Promise<OAuthClientView>;
}
