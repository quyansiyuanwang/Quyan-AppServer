import type { IamPrincipal } from "@quyan/shared";
import type { OAuthClientTarget, OAuthClientView } from "./oauth-client-management.store";
export interface PlatformOAuthClientStore {
  assertActor(principal: IamPrincipal): Promise<void>;
  groupSnapshot(principal: IamPrincipal): Promise<{ id: string; updateTime: Date }>;
  target(principal: IamPrincipal, id: string): Promise<OAuthClientTarget | null>;
  scan(principal: IamPrincipal, after?: string): Promise<OAuthClientTarget[]>;
  hydrate(principal: IamPrincipal, targets: readonly OAuthClientTarget[]): Promise<OAuthClientView[]>;
  recheck(principal: IamPrincipal, targets: readonly OAuthClientTarget[]): Promise<OAuthClientTarget[]>;
}
