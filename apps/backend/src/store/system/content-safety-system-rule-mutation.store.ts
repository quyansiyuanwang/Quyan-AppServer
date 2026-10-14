import type { ContentSafetyRule } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import type { ContentSafetySystemRuleTarget } from "./content-safety-system-read.store";
export type ContentSafetySystemRuleData = Pick<
  ContentSafetyRule,
  "name" | "type" | "pattern" | "direction" | "action" | "enabled" | "priority"
>;
export type ContentSafetySystemRuleChanges = Partial<
  Pick<ContentSafetyRule, "enabled" | "direction" | "action" | "priority">
>;
export interface ContentSafetySystemRuleMutationGuard {
  targets: readonly ContentSafetySystemRuleTarget[];
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
  authorizationRevision: string;
  authorizeCreated(id: string): Promise<void>;
}
export interface ContentSafetySystemRuleMutationStore {
  targets(ids: readonly string[]): Promise<ContentSafetySystemRuleTarget[]>;
  authorizationRevision(principal: IamPrincipal): Promise<string>;
  create(guard: ContentSafetySystemRuleMutationGuard, data: ContentSafetySystemRuleData): Promise<ContentSafetyRule>;
  update(guard: ContentSafetySystemRuleMutationGuard, data: ContentSafetySystemRuleData): Promise<ContentSafetyRule>;
  remove(guard: ContentSafetySystemRuleMutationGuard): Promise<void>;
  batch(
    guard: ContentSafetySystemRuleMutationGuard,
    changes: ContentSafetySystemRuleChanges,
  ): Promise<{ updated: number }>;
}

export interface ContentSafetySystemRuleImportGuard extends ContentSafetySystemRuleMutationGuard {
  sourceRevision: string;
}
export type ContentSafetySystemRuleImportOperation = {
  operation: "create" | "update";
  id?: string;
  data: ContentSafetySystemRuleData;
  source: "csv" | "default";
};
export interface ContentSafetySystemRuleImportStore extends ContentSafetySystemRuleMutationStore {
  collectionRevision(): Promise<string>;
  defaultTargets(patterns: readonly string[]): Promise<ContentSafetySystemRuleTarget[]>;
  applyImport(
    guard: ContentSafetySystemRuleImportGuard,
    operations: readonly ContentSafetySystemRuleImportOperation[],
  ): Promise<void>;
}
