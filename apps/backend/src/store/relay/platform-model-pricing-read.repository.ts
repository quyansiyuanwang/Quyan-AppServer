import { prisma } from "@/config/database";
import type { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { iamAccountDenied } from "../users/iam-account-principal";
import { isModelPricingRecordId } from "@/iam/resources/platform-model-pricing-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type { PlatformModelPricingReadStore, ModelPricingReadTarget } from "./platform-model-pricing-read.store";
const metadata = { id: true, status: true, model: true, createTime: true, updateTime: true } as const;
export class PlatformModelPricingReadRepository implements PlatformModelPricingReadStore {
  private static instance: PlatformModelPricingReadRepository;
  private constructor() {}
  static getInstance() {
    return (this.instance ??= new PlatformModelPricingReadRepository());
  }
  private actor(principal: IamPrincipal) {
    return platformManagementGroupSnapshot(principal, Permission.MODEL_PRICING_READ);
  }
  async scan(principal: IamPrincipal, after?: string) {
    await this.actor(principal);
    if (after !== undefined && !isModelPricingRecordId(after)) throw iamAccountDenied();
    return prisma.modelPricing.findMany({
      where: { status: 1, ...(after ? { id: { gt: after } } : {}) },
      select: metadata,
      orderBy: { id: "asc" },
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  private where(targets: readonly ModelPricingReadTarget[]): Prisma.ModelPricingWhereInput {
    if (
      !targets.length ||
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      targets.some((t) => !isModelPricingRecordId(t.id) || t.status !== 1)
    )
      throw iamAccountDenied();
    return { status: 1, OR: targets.map((t) => ({ id: t.id, model: t.model, updateTime: t.updateTime })) };
  }
  async recheck(principal: IamPrincipal, targets: readonly ModelPricingReadTarget[]) {
    await this.actor(principal);
    return targets.length ? prisma.modelPricing.findMany({ where: this.where(targets), select: metadata }) : [];
  }
  async hydrate(principal: IamPrincipal, targets: readonly ModelPricingReadTarget[]) {
    await this.actor(principal);
    return targets.length ? prisma.modelPricing.findMany({ where: this.where(targets) }) : [];
  }
}
