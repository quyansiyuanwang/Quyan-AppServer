import type { IamPrincipal } from "@quyan/shared";
import type { AuthCenterClientTarget, AuthCenterClientView } from "./auth-center-client-management.store";
import type { AuthCenterClientReviewListFilters } from "./auth-center-client.store";
export interface PlatformAuthCenterReviewTarget extends AuthCenterClientTarget {
  submittedAt: Date | null;
}
export type PlatformAuthCenterReviewView = AuthCenterClientView & {
  user: { id: string; username: string };
  reviewedBy: { id: string; username: string } | null;
};
export interface PlatformAuthCenterReviewStore {
  assertActor(principal: IamPrincipal): Promise<void>;
  scan(
    principal: IamPrincipal,
    filters: AuthCenterClientReviewListFilters,
    after?: string,
  ): Promise<PlatformAuthCenterReviewTarget[]>;
  hydrate(
    principal: IamPrincipal,
    targets: readonly PlatformAuthCenterReviewTarget[],
  ): Promise<PlatformAuthCenterReviewView[]>;
  recheck(
    principal: IamPrincipal,
    targets: readonly PlatformAuthCenterReviewTarget[],
    filters: AuthCenterClientReviewListFilters,
  ): Promise<PlatformAuthCenterReviewTarget[]>;
}
