import type { LegalPolicyVersion, Prisma, UserPolicyAcceptance } from "@prisma/client";
import type { LegalPolicyType, LegalPolicyPublishStatus } from "@/constant/legal-policy";

export interface LegalPolicyCreateInput {
  policyType: LegalPolicyType;
  version: number;
  title: string;
  summary?: string;
  content: string;
  contentFormat?: string;
  publishStatus?: LegalPolicyPublishStatus;
  isCurrent?: boolean;
  publishedAt?: Date | null;
  createdBy: string;
  updatedBy?: string | null;
}

export interface LegalPolicyUpdateInput {
  title?: string;
  summary?: string;
  content?: string;
  contentFormat?: string;
  publishStatus?: LegalPolicyPublishStatus;
  isCurrent?: boolean;
  publishedAt?: Date | null;
  updatedBy?: string | null;
}

export interface LegalPolicyQueryFilters {
  policyType?: LegalPolicyType;
  publishStatus?: LegalPolicyPublishStatus;
  isCurrent?: boolean;
}

export interface UserPolicyAcceptanceCreateInput {
  userId: string;
  policyVersionId: string;
  policyType: LegalPolicyType;
  source?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  acceptedAt?: Date;
}

export interface LegalPolicyStore {
  create(data: LegalPolicyCreateInput): Promise<LegalPolicyVersion>;
  update(id: string, data: LegalPolicyUpdateInput): Promise<LegalPolicyVersion>;
  delete(id: string): Promise<LegalPolicyVersion>;
  findById(id: string): Promise<LegalPolicyVersion | null>;
  findAll(filters?: LegalPolicyQueryFilters): Promise<LegalPolicyVersion[]>;
  findLatestVersionByPolicyType(policyType: LegalPolicyType): Promise<LegalPolicyVersion | null>;
  findDraftByPolicyType(policyType: LegalPolicyType): Promise<LegalPolicyVersion | null>;
  findCurrentPublishedByPolicyType(policyType: LegalPolicyType): Promise<LegalPolicyVersion | null>;
  findCurrentPublishedByPolicyTypes(policyTypes: LegalPolicyType[]): Promise<LegalPolicyVersion[]>;
  findLatestPublishedVersionByPolicyType(
    policyType: LegalPolicyType,
    excludeId?: string,
  ): Promise<LegalPolicyVersion | null>;
  publishVersion(id: string, policyType: LegalPolicyType): Promise<LegalPolicyVersion>;
  unpublishVersion(id: string, policyType: LegalPolicyType, fallbackCurrentId?: string): Promise<LegalPolicyVersion>;
  createAcceptance(data: UserPolicyAcceptanceCreateInput): Promise<UserPolicyAcceptance>;
  findAcceptedPolicyVersionIds(userId: string, policyVersionIds: string[]): Promise<string[]>;
  findLatestAcceptanceByUserAndType(userId: string, policyType: LegalPolicyType): Promise<UserPolicyAcceptance | null>;
}

export type LegalPolicyVersionWithRelations = Prisma.LegalPolicyVersionGetPayload<{
  include: {
    creator: true;
    updater: true;
  };
}>;
