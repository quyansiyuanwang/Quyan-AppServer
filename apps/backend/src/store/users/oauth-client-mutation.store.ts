import type { OAuthClientIdentity, OAuthClientTarget, OAuthClientView } from "./oauth-client-management.store";
import type { IamAccountUserMutationGuard } from "./iam-account-user-mutation";
import type { OAuthClientUpdateInput } from "./oauth-client.store";
export type OAuthClientMutationAction = "quyan:oauth:UpdateClient" | "quyan:oauth:SubmitClientReview";
export interface OAuthClientMutationGuard {
  identity: OAuthClientIdentity;
  target: OAuthClientTarget;
  users: IamAccountUserMutationGuard;
  scopeCheck?: () => Promise<void>;
}
export interface OAuthClientMutationStore {
  update(data: OAuthClientUpdateInput, guard: OAuthClientMutationGuard): Promise<OAuthClientView>;
}
