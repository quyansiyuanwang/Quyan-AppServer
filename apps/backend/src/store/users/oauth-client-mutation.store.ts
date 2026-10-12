import type { OAuthClientIdentity, OAuthClientTarget, OAuthClientView } from "./oauth-client-management.store";
import type { IamAccountUserMutationGuard } from "./iam-account-user-mutation";
import type { OAuthClientCreateInput, OAuthClientUpdateInput } from "./oauth-client.store";
export type OAuthClientMutationAction =
  | "quyan:oauth:UpdateClient"
  | "quyan:oauth:SubmitClientReview"
  | "quyan:oauth:RotateClientSecret"
  | "quyan:oauth:DeleteClient";
export interface OAuthClientMutationGuard {
  identity: OAuthClientIdentity;
  target: OAuthClientTarget;
  users: IamAccountUserMutationGuard;
  scopeCheck?: () => Promise<void>;
}
export interface OAuthClientCreateGuard {
  identity: OAuthClientIdentity;
  users: IamAccountUserMutationGuard;
  scopeCheck: () => Promise<void>;
}
export interface OAuthClientMutationStore {
  create(data: OAuthClientCreateInput, guard: OAuthClientCreateGuard): Promise<OAuthClientView>;
  update(data: OAuthClientUpdateInput, guard: OAuthClientMutationGuard): Promise<OAuthClientView>;
  revoke(guard: OAuthClientMutationGuard): Promise<OAuthClientView>;
}
