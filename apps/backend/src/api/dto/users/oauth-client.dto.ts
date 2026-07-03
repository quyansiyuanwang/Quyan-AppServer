export type OAuthClientType = "confidential" | "public";
export type OAuthClientReviewStatus = "draft" | "pending" | "approved" | "rejected";

export interface CreateOAuthClientDto {
  name: string;
  description?: string;
  redirectUris: string[];
  scopes?: string[];
  homepageUrl?: string;
  logoUrl?: string;
  policyUrl?: string;
  tosUrl?: string;
  clientType?: OAuthClientType;
}

export interface UpdateOAuthClientDto {
  name?: string;
  description?: string | null;
  redirectUris?: string[];
  scopes?: string[];
  homepageUrl?: string | null;
  logoUrl?: string | null;
  policyUrl?: string | null;
  tosUrl?: string | null;
  clientType?: OAuthClientType;
}

export interface OAuthClientDto {
  id: string;
  userId: string;
  reviewerUserId?: string;
  name: string;
  description?: string;
  clientId: string;
  clientSecretPreview?: string;
  clientType: OAuthClientType;
  reviewStatus: OAuthClientReviewStatus;
  reviewComment?: string;
  submittedAt?: string;
  reviewedAt?: string;
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
  lastUsedAt?: string;
  createTime: string;
  updateTime: string;
  hasClientSecret: boolean;
}

export interface OAuthClientWithSecretDto extends OAuthClientDto {
  clientSecret: string;
}

export interface SubmitOAuthClientReviewDto {
  id: string;
}

export interface ReviewOAuthClientDto {
  reviewStatus: Extract<OAuthClientReviewStatus, "approved" | "rejected">;
  reviewComment?: string;
}

export interface OAuthClientReviewListQueryDto {
  page?: number;
  pageSize?: number;
  reviewStatus?: OAuthClientReviewStatus;
  keyword?: string;
}

export interface OAuthClientReviewListItemDto extends OAuthClientDto {
  ownerUsername?: string;
  reviewerUsername?: string;
}

export interface OAuthClientReviewListResponseDto {
  items: OAuthClientReviewListItemDto[];
  total: number;
  page: number;
  pageSize: number;
}
