import type { RamPolicy, RamPolicyAttachment as _RamPolicyAttachment } from "@prisma/client";

export interface CreateRamPolicyInput {
  accountOwnerId: string;
  name: string;
  description?: string | null;
  permissions: string[];
  type?: string;
}

export interface UpdateRamPolicyInput {
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
  policyId: string;
  policyName: string;
  permissions: string[];
}

export interface RamPolicyStore {
  createPolicy(data: CreateRamPolicyInput): Promise<RamPolicy>;
  findPolicyById(policyId: string): Promise<RamPolicy | null>;
  findPolicyByName(accountOwnerId: string, name: string): Promise<RamPolicy | null>;
  listPolicies(accountOwnerId: string): Promise<RamPolicy[]>;
  updatePolicy(policyId: string, data: UpdateRamPolicyInput): Promise<RamPolicy>;
  softDeletePolicy(policyId: string): Promise<RamPolicy>;
  attachPolicy(accountOwnerId: string, policyId: string, targetType: string, targetId: string): Promise<void>;
  detachPolicy(policyId: string, targetType: string, targetId: string): Promise<void>;
  listAttachmentsByPolicy(policyId: string): Promise<PolicyAttachmentRecord[]>;
  listAttachmentsByTarget(targetType: string, targetId: string): Promise<PolicyAttachmentRecord[]>;
  listPoliciesForTarget(targetType: string, targetId: string): Promise<PolicyBindingInfo[]>;
}
