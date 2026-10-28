import type { IamPrincipal } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import type { ContentSafetySystemConfiguration } from "./content-safety-system-read.store";
export interface ContentSafetySystemConfigMutationGuard {
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
  sourceRevision: string;
  authorizationRevision: string;
}
export interface ContentSafetySystemConfigMutationStore {
  configuration(): Promise<ContentSafetySystemConfiguration>;
  authorizationRevision(principal: IamPrincipal): Promise<string>;
  update(
    updates: Readonly<Record<string, string>>,
    guard: ContentSafetySystemConfigMutationGuard,
  ): Promise<ContentSafetySystemConfiguration>;
}
