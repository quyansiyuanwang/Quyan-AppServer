export enum LegalPolicyType {
  TERMS_OF_SERVICE = 'terms_of_service',
  PRIVACY_POLICY = 'privacy_policy',
}

export const LEGAL_POLICY_TYPES = Object.values(LegalPolicyType) as LegalPolicyType[];

export enum LegalPolicyPublishStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
}

export const LEGAL_POLICY_PUBLISH_STATUSES = Object.values(LegalPolicyPublishStatus) as LegalPolicyPublishStatus[];
