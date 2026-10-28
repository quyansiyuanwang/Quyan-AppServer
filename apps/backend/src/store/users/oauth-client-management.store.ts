import type { OAuthClient } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
export interface OAuthClientIdentity {
  principal: IamPrincipal;
  oauth?: { id: string; clientId: string };
}
export type OAuthClientTarget = Pick<
  OAuthClient,
  "id" | "userId" | "status" | "isSystemClient" | "createTime" | "updateTime"
>;
export type OAuthClientView = Omit<OAuthClient, "clientSecretHash"> & { hasClientSecret: boolean };
export interface OAuthClientManagementStore {
  assertActor(identity: OAuthClientIdentity): Promise<void>;
  scan(identity: OAuthClientIdentity, after?: OAuthClientTarget): Promise<OAuthClientTarget[]>;
  recheck(identity: OAuthClientIdentity, targets: readonly OAuthClientTarget[]): Promise<OAuthClientTarget[]>;
  target(identity: OAuthClientIdentity, id: string): Promise<OAuthClientTarget | null>;
  hydrate(identity: OAuthClientIdentity, targets: readonly OAuthClientTarget[]): Promise<OAuthClientView[]>;
}
