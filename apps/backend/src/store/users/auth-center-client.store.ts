import type { AuthCenterClient } from "@prisma/client";

export interface AuthCenterClientReviewListFilters {
  reviewStatus?: string;
  keyword?: string;
  page: number;
  pageSize: number;
}

export interface AuthCenterClientReviewListItem extends AuthCenterClient {
  user: {
    id: string;
    username: string;
  };
  reviewedBy: {
    id: string;
    username: string;
  } | null;
}

export interface AuthCenterClientCreateInput {
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

export interface AuthCenterClientUpdateInput {
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

export interface AuthCenterClientStore {
  create(data: AuthCenterClientCreateInput): Promise<AuthCenterClient>;
  findById(id: string): Promise<AuthCenterClient | null>;
  findByClientId(clientId: string): Promise<AuthCenterClient | null>;
  findByUserId(userId: string): Promise<AuthCenterClient[]>;
  findReviewList(
    filters: AuthCenterClientReviewListFilters,
  ): Promise<{ items: AuthCenterClientReviewListItem[]; total: number }>;
  update(id: string, data: AuthCenterClientUpdateInput): Promise<AuthCenterClient>;
  delete(id: string): Promise<AuthCenterClient>;
}
