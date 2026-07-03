export interface AuthCenterAuthorizeQueryDto {
  response_type: "code";
  client_id: string;
  redirect_uri: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: "S256" | "plain";
  nonce?: string;
}

export interface AuthCenterAuthorizeDecisionDto extends AuthCenterAuthorizeQueryDto {
  approve: boolean;
}

export interface AuthCenterAuthorizationPreviewClientDto {
  clientId: string;
  name: string;
  description?: string;
  logoUrl?: string;
  homepageUrl?: string;
  policyUrl?: string;
  tosUrl?: string;
}

export interface AuthCenterAuthorizationPreviewDto {
  client: AuthCenterAuthorizationPreviewClientDto;
  requestedScopes: string[];
  previouslyGrantedScopes: string[];
  missingScopes: string[];
  requireConsent: boolean;
  redirectUri: string;
  state?: string;
}

export interface AuthCenterAuthorizationDecisionResponseDto {
  redirectTo: string;
}

export interface AuthCenterTokenDto {
  grant_type: "authorization_code" | "refresh_token" | "client_credentials";
  code?: string;
  redirect_uri?: string;
  client_id?: string;
  client_secret?: string;
  code_verifier?: string;
  refresh_token?: string;
  scope?: string;
}

export interface AuthCenterTokenResponseDto {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

export interface AuthCenterRevokeTokenDto {
  token: string;
  client_id?: string;
  client_secret?: string;
  token_type_hint?: "access_token" | "refresh_token";
}

export interface AuthCenterRevokeTokenResponseDto {
  revoked: true;
}

export interface AuthCenterJwkDto {
  [key: string]: unknown;
  kid: string;
  kty: string;
  alg: string;
  use: string;
}

export interface AuthCenterJwksResponseDto {
  keys: AuthCenterJwkDto[];
}

export interface AuthCenterDiscoveryResponseDto {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  response_types_supported: string[];
  grant_types_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  scopes_supported: string[];
  code_challenge_methods_supported: string[];
}
