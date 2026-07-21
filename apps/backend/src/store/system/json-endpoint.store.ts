import type { JsonEndpoint } from "@prisma/client";

export interface CreateJsonEndpointParams {
  userId: string;
  name: string;
  slug: string;
  isRootSlug?: boolean;
  rootSlug?: string | null;
  description?: string;
  jsonContent: any;
  apiKey?: string;
  isPublic: boolean;
}

export interface UpdateJsonEndpointParams {
  name?: string;
  description?: string;
  jsonContent?: any;
  apiKey?: string;
  isPublic?: boolean;
  isRootSlug?: boolean;
  rootSlug?: string | null;
}

export interface JsonEndpointStore {
  create(params: CreateJsonEndpointParams): Promise<JsonEndpoint>;
  findByRootSlug(slug: string): Promise<JsonEndpoint | null>;
  findByUserAndSlug(username: string, slug: string): Promise<JsonEndpoint | null>;
  findByApiKey(apiKey: string): Promise<JsonEndpoint | null>;
  findById(id: string): Promise<JsonEndpoint | null>;
  findByUserId(userId: string): Promise<JsonEndpoint[]>;
  findAll(): Promise<JsonEndpoint[]>;
  update(id: string, params: UpdateJsonEndpointParams): Promise<JsonEndpoint>;
  incrementAccessCount(id: string): void;
  delete(id: string): Promise<void>;
}
