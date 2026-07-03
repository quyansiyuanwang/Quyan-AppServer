import type { PolicyConsentRequiredData } from "@/api/dto/auth/auth.dto";

export interface PasskeyRegistrationOptionsResponse {
  options: Record<string, any>;
}

export interface PasskeyRegistrationVerifyRequest {
  response: Record<string, any>;
  /**
   * Passkey 名称
   */
  name?: string;
}

export interface PasskeyRegistrationVerifyResponse {
  success: boolean;
  credentialId: string;
}

export interface PasskeyAuthOptionsResponse {
  options: Record<string, any>;
}

export interface PasskeyAuthVerifyRequest {
  /** 会话 ID */
  sessionId: string;
  /** 是否已同意服务协议与隐私政策 */
  agreedToLegalPolicies: true;
  response: Record<string, any>;
}

export interface PasskeyAuthSuccessResponse {
  access_token: string;
}

export interface PasskeyAuthTwoFactorRequiredResponse {
  requiresTwoFactor: true;
  challengeToken: string;
  expiresIn: number;
}

export type PasskeyAuthVerifyResponse =
  | PasskeyAuthSuccessResponse
  | PasskeyAuthTwoFactorRequiredResponse
  | PolicyConsentRequiredData;

export interface PasskeyCredentialItem {
  id: string;
  credentialId: string;
  name?: string;
  deviceType?: string;
  backedUp: boolean;
  createdAt: string;
}

export interface PasskeyListResponse {
  credentials: PasskeyCredentialItem[];
}

export interface DeletePasskeyResponse {
  success: boolean;
}
