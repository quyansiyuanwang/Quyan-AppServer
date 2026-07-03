export interface OAuthAuthorizeQueryDto {
  response_type: "code";
  client_id: string;
  redirect_uri: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: "S256" | "plain";
  nonce?: string;
}

export interface OAuthAuthorizeDecisionDto extends OAuthAuthorizeQueryDto {
  approve: boolean;
}

export interface OAuthAuthorizationPreviewClientDto {
  clientId: string;
  name: string;
  description?: string;
  logoUrl?: string;
  homepageUrl?: string;
  policyUrl?: string;
  tosUrl?: string;
}

export interface OAuthAuthorizationPreviewDto {
  client: OAuthAuthorizationPreviewClientDto;
  requestedScopes: string[];
  previouslyGrantedScopes: string[];
  missingScopes: string[];
  requireConsent: boolean;
  redirectUri: string;
  state?: string;
}

export interface OAuthAuthorizationDecisionResponseDto {
  redirectTo: string;
}

export interface OAuthTokenDto {
  grant_type: "authorization_code" | "refresh_token";
  code?: string;
  redirect_uri?: string;
  client_id?: string;
  client_secret?: string;
  code_verifier?: string;
  refresh_token?: string;
}

export interface OAuthTokenResponseDto {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

export interface OAuthErrorResponseDto {
  error: string;
  error_description: string;
}

export interface OAuthRevokeTokenDto {
  token: string;
  client_id?: string;
  client_secret?: string;
  token_type_hint?: "access_token" | "refresh_token";
}

export interface OAuthRevokeTokenResponseDto {
  revoked: true;
}
