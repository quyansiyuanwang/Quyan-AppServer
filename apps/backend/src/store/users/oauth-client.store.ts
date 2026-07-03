import type { OAuthClient } from "@prisma/client";

export interface OAuthClientReviewListFilters {
  reviewStatus?: string;
  keyword?: string;
  page: number;
  pageSize: number;
}

export interface OAuthClientReviewListItem extends OAuthClient {
  user: {
    id: string;
    username: string;
  };
  reviewedBy: {
    id: string;
    username: string;
  } | null;
}

export interface OAuthClientCreateInput {
  userId: string;
  name: string;
  description?: string;
  clientId: string;
  clientSecretHash?: string;
  clientSecretPreview?: string;
  clientType: string;
  reviewStatus: string;
  reviewComment?: string;
  submittedAt?: Date | null;
  reviewedAt?: Date | null;
  reviewedByUserId?: string | null;
  grantTypes: string[];
  redirectUris: string[];
  scopes: string[];
  homepageUrl?: string;
  logoUrl?: string;
  policyUrl?: string;
  tosUrl?: string;
  isPkceRequired: boolean;
  accessTokenLifetime: number;
  refreshTokenLifetime: number;
}

export interface OAuthClientUpdateInput {
  name?: string;
  description?: string | null;
  clientSecretHash?: string | null;
  clientSecretPreview?: string | null;
  clientType?: string;
  reviewStatus?: string;
  reviewComment?: string | null;
  submittedAt?: Date | null;
  reviewedAt?: Date | null;
  reviewedByUserId?: string | null;
  grantTypes?: string[];
  redirectUris?: string[];
  scopes?: string[];
  homepageUrl?: string | null;
  logoUrl?: string | null;
  policyUrl?: string | null;
  tosUrl?: string | null;
  isPkceRequired?: boolean;
  accessTokenLifetime?: number;
  refreshTokenLifetime?: number;
  lastUsedAt?: Date | null;
}

export interface OAuthClientStore {
  create(data: OAuthClientCreateInput): Promise<OAuthClient>;
  findById(id: string): Promise<OAuthClient | null>;
  findByClientId(clientId: string): Promise<OAuthClient | null>;
  findByUserId(userId: string): Promise<OAuthClient[]>;
  findReviewList(filters: OAuthClientReviewListFilters): Promise<{ items: OAuthClientReviewListItem[]; total: number }>;
  update(id: string, data: OAuthClientUpdateInput): Promise<OAuthClient>;
  delete(id: string): Promise<OAuthClient>;
}
