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
}
export interface PlatformModelPricingWriteStore {
  target(principal: IamPrincipal, id: string): Promise<ModelPricingWriteTarget | null>;
  create(input: CreateModelPricingRequest, guard: PlatformModelPricingWriteGuard): Promise<ModelPricing>;
  update(
    target: ModelPricingWriteTarget,
    input: UpdateModelPricingRequest,
    guard: PlatformModelPricingWriteGuard,
  ): Promise<ModelPricing>;
  remove(target: ModelPricingWriteTarget, guard: PlatformModelPricingWriteGuard): Promise<ModelPricing>;
}
