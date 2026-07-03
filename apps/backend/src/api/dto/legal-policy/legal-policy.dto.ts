import type { LegalPolicyType } from "@/constant/legal-policy";

export interface CreateLegalPolicyDto {
  /** 协议类型 */
  policyType: LegalPolicyType;
  /** 标题 */
  title: string;
  /** 摘要 */
  summary?: string;
  /** Markdown 内容 */
  content: string;
}

export interface UpdateLegalPolicyDto {
  /** 标题 */
  title?: string;
  /** 摘要 */
  summary?: string;
  /** Markdown 内容 */
  content?: string;
}

export interface LegalPolicyDto {
  id: string;
  policyType: LegalPolicyType;
  version: number;
  title: string;
  summary?: string;
  content: string;
  contentFormat: string;
  publishStatus: string;
  isCurrent: boolean;
  publishedAt?: string;
  createdBy: string;
  createdByName?: string;
  updatedBy?: string;
  updatedByName?: string;
  createTime: string;
  updateTime: string;
}

export interface LegalPolicyListItemDto {
  id: string;
  policyType: LegalPolicyType;
  version: number;
  title: string;
  summary?: string;
  publishStatus: string;
  isCurrent: boolean;
  publishedAt?: string;
  createdByName?: string;
  updatedByName?: string;
  createTime: string;
  updateTime: string;
}

export interface GetCurrentLegalPoliciesDto {
  /** 协议类型，可选；不传时返回全部当前协议 */
  policyType?: LegalPolicyType;
  /** 验证码 token */
  captchaToken?: string;
}

export interface PublicLegalPolicyDto {
  id: string;
  policyType: LegalPolicyType;
  version: number;
  title: string;
  summary?: string;
  content: string;
  contentFormat: string;
  publishedAt?: string;
  updateTime: string;
}

export interface CurrentLegalPoliciesResponse {
  policies: PublicLegalPolicyDto[];
}
