import type { LegalPolicyVersion } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import type { LegalPolicyWriteTarget } from "./platform-legal-policy-write.store";
export type LegalPolicyPublicationOperation = "PublishVersion" | "UnpublishVersion";
export interface LegalPolicyPublicationTransition {
  operation: LegalPolicyPublicationOperation;
  target: LegalPolicyWriteTarget;
  affected: LegalPolicyWriteTarget[];
  fallbackId?: string;
}
export interface LegalPolicyPublicationGuard {
  transition: LegalPolicyPublicationTransition;
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
}
export interface PlatformLegalPolicyPublicationStore {
  prepare(
    principal: IamPrincipal,
    id: string,
    operation: LegalPolicyPublicationOperation,
  ): Promise<LegalPolicyPublicationTransition>;
  commit(guard: LegalPolicyPublicationGuard): Promise<LegalPolicyVersion>;
}
