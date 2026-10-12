import type { IamPrincipal } from "@quyan/shared";
import type { OAuthClientTarget, OAuthClientView } from "./oauth-client-management.store";
import type { OAuthClientReviewListFilters } from "./oauth-client.store";
export interface PlatformOAuthReviewTarget extends OAuthClientTarget {
  submittedAt: Date | null;
}
export type PlatformOAuthReviewView = OAuthClientView & {
  user: { id: string; username: string };
  reviewedBy: { id: string; username: string } | null;
};
export interface PlatformOAuthReviewStore {
  assertActor(principal: IamPrincipal): Promise<void>;
  scan(
    principal: IamPrincipal,
    filters: OAuthClientReviewListFilters,
    after?: string,
  ): Promise<PlatformOAuthReviewTarget[]>;
  hydrate(principal: IamPrincipal, targets: readonly PlatformOAuthReviewTarget[]): Promise<PlatformOAuthReviewView[]>;
  recheck(
    principal: IamPrincipal,
    targets: readonly PlatformOAuthReviewTarget[],
    filters: OAuthClientReviewListFilters,
  ): Promise<PlatformOAuthReviewTarget[]>;
}
