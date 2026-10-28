import type { IamManagementPageResult } from "@quyan/shared";
import type { IamManagementPage, IamManagementSearchPage } from "@/iam/management-pagination";
import type { IamVersionPagination } from "@/iam/policy-version-pagination";
import type { RamPolicy, RamPolicyVersion } from "@prisma/client";

export type RamPolicyWithVersion = RamPolicy & { defaultVersion?: RamPolicyVersion | null };
export interface IamVersionWrite {
  document: import("@quyan/shared").NormalizedIamPolicyDocument;
  documentHash: string;
  createdBy: string;
}
export interface CreateRamPolicyInput {
  accountOwnerId: string;
  name: string;
  description?: string | null;
  permissions: string[];
  type?: string;
  iamVersion?: IamVersionWrite;
}

export interface UpdateRamPolicyInput {
  iamVersion?: IamVersionWrite;
  expectedDocumentHash?: string;
  description?: string | null;
  permissions?: string[];
  status?: number;
}

export interface PolicyAttachmentRecord {
  id: string;
  policyId: string;
  policyName: string;
  targetType: string;
  targetId: string;
  targetName?: string | null;
  createTime: Date;
}

export interface PolicyBindingInfo {
  legacyPermissions?: unknown;
  accountOwnerId?: string;
  documentFormat?: string;
  versionId?: string;
  versionCreatedBy?: string;
  document?: unknown;
  documentHash?: string;
  validationState?: string;
  policyId: string;
  policyName: string;
  permissions: string[];
}

export interface PolicyBindingInfoWithTarget extends PolicyBindingInfo {
  targetId: string;
}

export interface RamPolicyStore {
  createPolicy(data: CreateRamPolicyInput): Promise<RamPolicyWithVersion>;
  findPolicyById(policyId: string): Promise<RamPolicyWithVersion | null>;
  findPolicyByName(accountOwnerId: string, name: string): Promise<RamPolicyWithVersion | null>;
  listPolicies(accountOwnerId: string): Promise<RamPolicyWithVersion[]>;
  listPoliciesPage(
    accountOwnerId: string,
    pagination: IamManagementSearchPage,
  ): Promise<IamManagementPageResult<RamPolicyWithVersion>>;
  updatePolicy(policyId: string, data: UpdateRamPolicyInput): Promise<RamPolicyWithVersion>;
  listVersions(
    policyId: string,
    pagination: IamVersionPagination,
  ): Promise<{ items: RamPolicyVersion[]; total: number }>;
  findVersion(policyId: string, versionId: string): Promise<RamPolicyVersion | null>;
  setDefaultVersion(policyId: string, versionId: string, expectedDocumentHash: string): Promise<void>;
  softDeletePolicy(policyId: string): Promise<RamPolicyWithVersion>;
  attachPolicy(accountOwnerId: string, policyId: string, targetType: string, targetId: string): Promise<void>;
  detachPolicy(policyId: string, targetType: string, targetId: string): Promise<void>;
  listAttachmentsByPolicy(policyId: string): Promise<PolicyAttachmentRecord[]>;
  listAttachmentPage(
    accountOwnerId: string,
    policyId: string,
    pagination: IamManagementPage,
  ): Promise<IamManagementPageResult<PolicyAttachmentRecord>>;
  listAttachmentsByTarget(targetType: string, targetId: string): Promise<PolicyAttachmentRecord[]>;
  listPoliciesForTarget(targetType: string, targetId: string, accountOwnerId: string): Promise<PolicyBindingInfo[]>;
  listPoliciesForTargets(
    targetType: string,
    targetIds: string[],
    accountOwnerId: string,
  ): Promise<PolicyBindingInfoWithTarget[]>;
}
