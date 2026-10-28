import { prisma } from "@/config/database";
import type { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { iamAccountDenied } from "../users/iam-account-principal";
import { isOjPricingRecordId } from "@/iam/resources/platform-oj-pricing-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { ojPricingModelParamsSchema } from "@/api/schema/oj-submitter/oj-submitter.schema";
import type { PlatformOjPricingReadStore, OjPricingReadTarget } from "./platform-oj-pricing-read.store";
const metadata = { id: true, status: true, model: true, createTime: true, updateTime: true } as const;
export class PlatformOjPricingReadRepository implements PlatformOjPricingReadStore {
  private static instance: PlatformOjPricingReadRepository;
  private constructor() {}
  static getInstance() {
    return (this.instance ??= new PlatformOjPricingReadRepository());
  }
  private actor(principal: IamPrincipal) {
    return platformManagementGroupSnapshot(principal, Permission.OJ_PRICING_READ);
  }
  async scan(principal: IamPrincipal, after?: string) {
    await this.actor(principal);
    if (after !== undefined && !isOjPricingRecordId(after)) throw iamAccountDenied();
    return prisma.oJModelPricing.findMany({
      where: { status: 1, ...(after ? { id: { gt: after } } : {}) },
      select: metadata,
      orderBy: { id: "asc" },
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  async target(principal: IamPrincipal, model: string) {
    await this.actor(principal);
    const parsed = ojPricingModelParamsSchema.safeParse({ model });
    if (!parsed.success) throw iamAccountDenied();
    return prisma.oJModelPricing.findFirst({ where: { status: 1, model: parsed.data.model }, select: metadata });
  }
  private where(targets: readonly OjPricingReadTarget[]): Prisma.OJModelPricingWhereInput {
    if (
      !targets.length ||
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      targets.some((t) => !isOjPricingRecordId(t.id) || t.status !== 1)
    )
      throw iamAccountDenied();
    return { status: 1, OR: targets.map((t) => ({ id: t.id, model: t.model, updateTime: t.updateTime })) };
  }
  async recheck(principal: IamPrincipal, targets: readonly OjPricingReadTarget[]) {
    await this.actor(principal);
    return targets.length ? prisma.oJModelPricing.findMany({ where: this.where(targets), select: metadata }) : [];
  }
  async hydrate(principal: IamPrincipal, targets: readonly OjPricingReadTarget[]) {
    await this.actor(principal);
    return targets.length ? prisma.oJModelPricing.findMany({ where: this.where(targets) }) : [];
  }
}
