import type { OJModelPricing } from "@prisma/client";
import type { IamPrincipal, Permission } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import type { CreateOJModelPricingRequest, UpdateOJModelPricingRequest } from "@/api/dto/oj-submitter/oj-qa.dto";
export type OjPricingWriteTarget = Pick<OJModelPricing, "id" | "model" | "status" | "updateTime">;
export interface PlatformOjPricingWriteGuard {
  permission: Permission;
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
  recheckEntry: (id: string) => Promise<void>;
}
export interface PlatformOjPricingWriteStore {
  target(principal: IamPrincipal, model: string): Promise<OjPricingWriteTarget | null>;
  create(input: CreateOJModelPricingRequest, guard: PlatformOjPricingWriteGuard): Promise<OJModelPricing>;
  update(
    target: OjPricingWriteTarget,
    input: UpdateOJModelPricingRequest,
    guard: PlatformOjPricingWriteGuard,
  ): Promise<OJModelPricing>;
  remove(target: OjPricingWriteTarget, guard: PlatformOjPricingWriteGuard): Promise<OJModelPricing>;
}
