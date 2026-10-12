import type { LegalPolicyVersion } from "@prisma/client";
import type { IamPrincipal, Permission } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import type { CreateLegalPolicyDto, UpdateLegalPolicyDto } from "@/api/dto/legal-policy/legal-policy.dto";
export type LegalPolicyDraftOperation = "CreateVersion" | "UpdateVersion" | "DeleteVersion";
export type LegalPolicyWriteTarget = Pick<
  LegalPolicyVersion,
  "id" | "status" | "policyType" | "version" | "publishStatus" | "isCurrent" | "updateTime"
>;
export interface PlatformLegalPolicyWriteGuard {
  operation: LegalPolicyDraftOperation;
  permission: Permission;
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
  recheckVersion: (id: string) => Promise<void>;
}
export interface PlatformLegalPolicyWriteStore {
  target(principal: IamPrincipal, id: string, permission: Permission): Promise<LegalPolicyWriteTarget | null>;
  create(input: CreateLegalPolicyDto, guard: PlatformLegalPolicyWriteGuard): Promise<LegalPolicyVersion>;
  update(
    target: LegalPolicyWriteTarget,
    input: UpdateLegalPolicyDto,
    guard: PlatformLegalPolicyWriteGuard,
  ): Promise<LegalPolicyVersion>;
  remove(target: LegalPolicyWriteTarget, guard: PlatformLegalPolicyWriteGuard): Promise<LegalPolicyVersion>;
}
