import type { IamPrincipal } from "@quyan/shared";
import type { JsonEndpoint } from "@prisma/client";
export type JsonEndpointTarget = Pick<JsonEndpoint, "id" | "userId" | "createTime" | "updateTime">;
export type JsonEndpointPublicView = Omit<JsonEndpoint, "apiKey"> & { hasPassword: boolean; ownerUsername: string };
export type JsonEndpointOwnerTarget = { id: string; userId: string; createTime: Date; updateTime: Date };
export interface JsonEndpointManagementStore {
  assertActor(principal: IamPrincipal): Promise<void>;
  deleteTarget(
    principal: IamPrincipal,
    target: JsonEndpointTarget,
  ): Promise<{ id: string; userId: string; name: string; slug: string }>;
  assertOwner(principal: IamPrincipal, userId: string): Promise<void>;
  scan(principal: IamPrincipal, ownerUserId?: string, after?: JsonEndpointTarget): Promise<JsonEndpointTarget[]>;
  target(principal: IamPrincipal, id: string): Promise<JsonEndpointTarget | null>;
  hydrate(principal: IamPrincipal, targets: readonly JsonEndpointTarget[]): Promise<JsonEndpointPublicView[]>;
  scanOwners(principal: IamPrincipal, after?: JsonEndpointOwnerTarget): Promise<JsonEndpointOwnerTarget[]>;
  hydrateOwners(
    principal: IamPrincipal,
    targets: readonly JsonEndpointOwnerTarget[],
  ): Promise<{ id: string; username: string }[]>;
}
