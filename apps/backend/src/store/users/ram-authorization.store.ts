import type { IamManagementPage } from "@/iam/management-pagination";
import type { RamAuthorization } from "@prisma/client";
import type { RamPolicyWithVersion } from "./ram-policy.store";
export type RamAuthorizationWithPolicy = RamAuthorization & { policy: RamPolicyWithVersion };
export interface IamAuthorizationTarget {
  principalType: string;
  principalId: string;
}
export interface CreateRamAuthorizationInput {
  accountOwnerId: string;
  principalType: string;
  principalId: string;
  policyId: string;
  scopeType: string;
  scopeResourceId?: string | null;
  scopeArn?: string | null;
  expectedGroupUpdateTime?: Date;
  expectedVersionId?: string | null;
  expectedDocumentHash?: string | null;
  scopeKey: string;
  description?: string | null;
  createdBy: string;
}
export interface RamAuthorizationStore {
  create(data: CreateRamAuthorizationInput): Promise<RamAuthorization>;
  list(
    accountOwnerId: string,
    principalType?: string,
    principalId?: string,
    page?: IamManagementPage,
  ): Promise<RamAuthorization[]>;
  listForPrincipals(
    accountOwnerId: string,
    targets: readonly IamAuthorizationTarget[],
  ): Promise<RamAuthorizationWithPolicy[]>;
  listForPolicy(policyId: string): Promise<RamAuthorization[]>;
  listForResourceGroup(groupId: string): Promise<RamAuthorizationWithPolicy[]>;
  findById(id: string): Promise<RamAuthorization | null>;
  delete(id: string): Promise<void>;
}
