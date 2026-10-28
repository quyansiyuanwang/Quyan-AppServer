import type { IamPrincipal } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "./iam-account-user-mutation";
import type { AuthCenterClientView } from "./auth-center-client-management.store";
import type { PlatformAuthCenterReviewTarget } from "./platform-auth-center-review.store";
export type PlatformAuthCenterReviewMutationAction =
  | "quyan:auth_center:ReviewClient"
  | "quyan:auth_center:DeleteReviewedClient";
export interface PlatformAuthCenterReviewMutationGuard {
  action: PlatformAuthCenterReviewMutationAction;
  target: PlatformAuthCenterReviewTarget & { reviewStatus: string };
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
}
export interface PlatformAuthCenterReviewDecision {
  reviewStatus: "approved" | "rejected";
  reviewComment: string | null;
}
export interface PlatformAuthCenterReviewMutationStore {
  groupSnapshot(principal: IamPrincipal): Promise<{ id: string; updateTime: Date }>;
  target(principal: IamPrincipal, id: string): Promise<PlatformAuthCenterReviewMutationGuard["target"] | null>;
  hydrate(
    principal: IamPrincipal,
    target: PlatformAuthCenterReviewMutationGuard["target"],
  ): Promise<AuthCenterClientView | null>;
  mutate(
    guard: PlatformAuthCenterReviewMutationGuard,
    decision?: PlatformAuthCenterReviewDecision,
  ): Promise<AuthCenterClientView | undefined>;
}
