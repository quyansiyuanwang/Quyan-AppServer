import type { AuthCenterClientCreateInput, AuthCenterClientUpdateInput } from "./auth-center-client.store";
import type {
  OAuthClientIdentity,
  AuthCenterClientTarget,
  AuthCenterClientView,
} from "./auth-center-client-management.store";
import type { IamAccountUserMutationGuard } from "./iam-account-user-mutation";
export type AuthCenterClientMutationAction =
  | "quyan:auth_center:UpdateClient"
  | "quyan:auth_center:RotateClientSecret"
  | "quyan:auth_center:SubmitClientReview"
  | "quyan:auth_center:DeleteClient";
export interface AuthCenterClientMutationGuard {
  action: AuthCenterClientMutationAction;
  identity: OAuthClientIdentity;
  target: AuthCenterClientTarget;
  users: IamAccountUserMutationGuard;
  scopeCheck?: () => Promise<void>;
}
export interface AuthCenterClientCreateGuard {
  action: "quyan:auth_center:CreateClient";
  identity: OAuthClientIdentity;
  users: IamAccountUserMutationGuard;
  scopeCheck: () => Promise<void>;
}
export interface AuthCenterClientMutationStore {
  create(data: AuthCenterClientCreateInput, guard: AuthCenterClientCreateGuard): Promise<AuthCenterClientView>;
  update(data: AuthCenterClientUpdateInput, guard: AuthCenterClientMutationGuard): Promise<AuthCenterClientView>;
  revoke(guard: AuthCenterClientMutationGuard): Promise<AuthCenterClientView>;
}
