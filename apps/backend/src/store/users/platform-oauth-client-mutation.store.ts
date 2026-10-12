import type { OAuthClientTarget, OAuthClientView } from "./oauth-client-management.store";
import type { OAuthClientUpdateInput } from "./oauth-client.store";
import type { IamAccountUserMutationGuard } from "./iam-account-user-mutation";
export interface PlatformOAuthClientMutationGuard {
  target: OAuthClientTarget;
  users: IamAccountUserMutationGuard;
  group: { id: string; updateTime: Date };
  scopeCheck?: () => Promise<void>;
}
export interface PlatformOAuthClientMutationStore {
  update(data: OAuthClientUpdateInput, guard: PlatformOAuthClientMutationGuard): Promise<OAuthClientView>;
}
