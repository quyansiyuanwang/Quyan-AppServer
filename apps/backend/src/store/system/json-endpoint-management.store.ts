import type { IamPrincipal } from "@quyan/shared";
import type { CreateJsonEndpointParams, UpdateJsonEndpointParams } from "./json-endpoint.store";
import type { JsonEndpoint } from "@prisma/client";
export type JsonEndpointTarget = Pick<
  JsonEndpoint,
  "id" | "userId" | "createTime" | "updateTime" | "isRootSlug" | "slug"
>;
export type JsonEndpointPublicView = Omit<JsonEndpoint, "apiKey"> & { hasPassword: boolean; ownerUsername: string };
export type JsonEndpointOwnerTarget = { id: string; userId: string; createTime: Date; updateTime: Date };
export type JsonEndpointCreationOwner = { id: string; username: string; updateTime: Date };
export interface JsonEndpointManagementStore {
  creationOwner(principal: IamPrincipal, ownerUserId: string): Promise<JsonEndpointCreationOwner | null>;
  userSlugExists(userId: string, slug: string): Promise<boolean>;
  createTarget(
    principal: IamPrincipal,
    owner: JsonEndpointCreationOwner,
    data: CreateJsonEndpointParams,
  ): Promise<JsonEndpointPublicView>;
  assertActor(principal: IamPrincipal): Promise<void>;
  rootSlugExists(slug: string): Promise<boolean>;
  readConfiguration(principal: IamPrincipal, target: JsonEndpointTarget): Promise<JsonEndpoint | null>;
  updateTarget(
    principal: IamPrincipal,
    target: JsonEndpointTarget,
    data: UpdateJsonEndpointParams,
  ): Promise<JsonEndpointPublicView>;
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
