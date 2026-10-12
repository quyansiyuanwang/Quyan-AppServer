import type { IamPrincipal } from "@quyan/shared";
import type { OAuthClientTarget, OAuthClientView } from "./oauth-client-management.store";
export interface PlatformOAuthClientStore {
  assertActor(principal: IamPrincipal): Promise<void>;
  scan(principal: IamPrincipal, after?: string): Promise<OAuthClientTarget[]>;
  hydrate(principal: IamPrincipal, targets: readonly OAuthClientTarget[]): Promise<OAuthClientView[]>;
  recheck(principal: IamPrincipal, targets: readonly OAuthClientTarget[]): Promise<OAuthClientTarget[]>;
}
