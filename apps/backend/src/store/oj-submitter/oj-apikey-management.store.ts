import type { OJAPIKey } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
export type OjApiKeyTarget = Pick<OJAPIKey, "id" | "userId" | "status" | "updateTime">;
export interface OjApiKeyManagementStore {
  target(principal: IamPrincipal, id: string): Promise<OjApiKeyTarget | null>;
  revoke(principal: IamPrincipal, target: OjApiKeyTarget): Promise<{ id: string; userId: string; name: string | null }>;
}
