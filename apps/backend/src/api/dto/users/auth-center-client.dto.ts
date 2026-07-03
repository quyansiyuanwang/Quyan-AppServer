export type AuthCenterClientType = "confidential" | "public";
export type AuthCenterClientReviewStatus = "draft" | "pending" | "approved" | "rejected";
export type AuthCenterGrantType = "authorization_code" | "refresh_token" | "client_credentials";

export interface CreateAuthCenterClientDto {
  name: string;
  description?: string;
  redirectUris?: string[];
  scopes?: string[];
  homepageUrl?: string;
  logoUrl?: string;
  policyUrl?: string;
  tosUrl?: string;
  clientType?: AuthCenterClientType;
  grantTypes?: AuthCenterGrantType[];
  isPkceRequired?: boolean;
  accessTokenLifetime?: number;
  refreshTokenLifetime?: number;
}

export interface UpdateAuthCenterClientDto {
  name?: string;
  description?: string | null;
  redirectUris?: string[];
  scopes?: string[];
  homepageUrl?: string | null;
  logoUrl?: string | null;
  policyUrl?: string | null;
  tosUrl?: string | null;
  clientType?: AuthCenterClientType;
  grantTypes?: AuthCenterGrantType[];
  isPkceRequired?: boolean;
  accessTokenLifetime?: number;
  refreshTokenLifetime?: number;
}

export interface AuthCenterClientDto {
  id: string;
  userId: string;
  reviewerUserId?: string;
  name: string;
  description?: string;
  clientId: string;
  clientSecretPreview?: string;
  clientType: AuthCenterClientType;
  reviewStatus: AuthCenterClientReviewStatus;
  reviewComment?: string;
  submittedAt?: string;
  reviewedAt?: string;
  grantTypes: AuthCenterGrantType[];
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

export interface AuthCenterClientWithSecretDto extends AuthCenterClientDto {
  clientSecret: string;
}

export interface ReviewAuthCenterClientDto {
  reviewStatus: Extract<AuthCenterClientReviewStatus, "approved" | "rejected">;
  reviewComment?: string;
}

export interface AuthCenterClientReviewListQueryDto {
  page?: number;
  pageSize?: number;
  reviewStatus?: AuthCenterClientReviewStatus;
  keyword?: string;
}

export interface AuthCenterClientReviewListItemDto extends AuthCenterClientDto {
  ownerUsername?: string;
  reviewerUsername?: string;
}

export interface AuthCenterClientReviewListResponseDto {
  items: AuthCenterClientReviewListItemDto[];
  total: number;
  page: number;
  pageSize: number;
}
