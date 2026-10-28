import type { AuthCenterClient } from "@prisma/client";
export type { OAuthClientIdentity } from "./oauth-client-management.store";
import type { OAuthClientIdentity } from "./oauth-client-management.store";
export type AuthCenterClientTarget = Pick<AuthCenterClient, "id" | "userId" | "status" | "createTime" | "updateTime">;
export type AuthCenterClientView = Omit<AuthCenterClient, "clientSecretHash"> & { hasClientSecret: boolean };
export interface AuthCenterClientManagementStore {
  assertActor(identity: OAuthClientIdentity): Promise<void>;
  scan(identity: OAuthClientIdentity, after?: AuthCenterClientTarget): Promise<AuthCenterClientTarget[]>;
  recheck(identity: OAuthClientIdentity, targets: readonly AuthCenterClientTarget[]): Promise<AuthCenterClientTarget[]>;
  target(identity: OAuthClientIdentity, id: string): Promise<AuthCenterClientTarget | null>;
  hydrate(identity: OAuthClientIdentity, targets: readonly AuthCenterClientTarget[]): Promise<AuthCenterClientView[]>;
}
