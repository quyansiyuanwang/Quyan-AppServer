import type { OJAPIKey } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
export type OjApiKeyTarget = Pick<OJAPIKey, "id" | "userId" | "status" | "createTime" | "updateTime">;
export type OjApiKeyView = Pick<
  OJAPIKey,
  "id" | "userId" | "name" | "requestCount" | "totalTokens" | "expiresAt" | "lastUsedAt" | "createTime" | "channelId"
> & {
  key?: string;
  channel: { name: string } | null;
};
export interface OjApiKeyManagementStore {
  assertActor(principal: IamPrincipal): Promise<void>;
  scan(principal: IamPrincipal, after?: OjApiKeyTarget): Promise<OjApiKeyTarget[]>;
  hydrate(principal: IamPrincipal, targets: OjApiKeyTarget[], revealIds: readonly string[]): Promise<OjApiKeyView[]>;
  target(principal: IamPrincipal, id: string): Promise<OjApiKeyTarget | null>;
  revoke(principal: IamPrincipal, target: OjApiKeyTarget): Promise<{ id: string; userId: string; name: string | null }>;
}
