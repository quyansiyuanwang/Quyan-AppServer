import type { IamPrincipal } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "./iam-account-user-mutation";
import type { OAuthClientView } from "./oauth-client-management.store";
import type { PlatformOAuthReviewTarget } from "./platform-oauth-review.store";
export type PlatformOAuthReviewMutationAction = "quyan:oauth:ReviewClient" | "quyan:oauth:DeleteReviewedClient";
export interface PlatformOAuthReviewMutationGuard {
  action: PlatformOAuthReviewMutationAction;
  target: PlatformOAuthReviewTarget & { reviewStatus: string };
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
}
export interface PlatformOAuthReviewDecision {
  reviewStatus: "approved" | "rejected";
  reviewComment: string | null;
}
export interface PlatformOAuthReviewMutationStore {
  groupSnapshot(principal: IamPrincipal): Promise<{ id: string; updateTime: Date }>;
  target(principal: IamPrincipal, id: string): Promise<PlatformOAuthReviewMutationGuard["target"] | null>;
  hydrate(principal: IamPrincipal, target: PlatformOAuthReviewMutationGuard["target"]): Promise<OAuthClientView | null>;
  mutate(
    guard: PlatformOAuthReviewMutationGuard,
    decision?: PlatformOAuthReviewDecision,
  ): Promise<OAuthClientView | undefined>;
}
