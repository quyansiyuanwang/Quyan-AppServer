import type { ModelPricing } from "@prisma/client";
import type { IamPrincipal, Permission } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import type { CreateModelPricingRequest, UpdateModelPricingRequest } from "@/api/dto/relay/model-pricing.dto";
export type ModelPricingWriteTarget = Pick<ModelPricing, "id" | "model" | "status" | "updateTime">;
export interface PlatformModelPricingWriteGuard {
  permission: Permission;
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
  recheckEntry: (id: string) => Promise<void>;
  recheckEntries: (ids: readonly string[]) => Promise<void>;
}
export interface ModelPricingImportReceipt {
  created: number;
  updated: number;
  total: number;
  recordIds: string[];
}
export interface PlatformModelPricingWriteStore {
  prepareImport(
    principal: IamPrincipal,
    input: readonly CreateModelPricingRequest[],
  ): Promise<(ModelPricingWriteTarget | null)[]>;
  importModels(
    input: readonly CreateModelPricingRequest[],
    targets: readonly (ModelPricingWriteTarget | null)[],
    guard: PlatformModelPricingWriteGuard,
  ): Promise<ModelPricingImportReceipt>;
  target(principal: IamPrincipal, id: string): Promise<ModelPricingWriteTarget | null>;
  create(input: CreateModelPricingRequest, guard: PlatformModelPricingWriteGuard): Promise<ModelPricing>;
  update(
    target: ModelPricingWriteTarget,
    input: UpdateModelPricingRequest,
    guard: PlatformModelPricingWriteGuard,
  ): Promise<ModelPricing>;
  remove(target: ModelPricingWriteTarget, guard: PlatformModelPricingWriteGuard): Promise<ModelPricing>;
}
