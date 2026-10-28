import { prisma } from "@/config/database";
import type { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { iamAccountDenied } from "../users/iam-account-principal";
import { isLegalPolicyVersionId } from "@/iam/resources/platform-legal-policy-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type { PlatformLegalPolicyReadStore, LegalPolicyReadTarget } from "./platform-legal-policy-read.store";
const metadata = {
  id: true,
  status: true,
  policyType: true,
  version: true,
  createTime: true,
  updateTime: true,
} as const;
const summary = {
  ...metadata,
  title: true,
  summary: true,
  publishStatus: true,
  isCurrent: true,
  publishedAt: true,
  createdBy: true,
  updatedBy: true,
} as const;
export class PlatformLegalPolicyReadRepository implements PlatformLegalPolicyReadStore {
  private static instance: PlatformLegalPolicyReadRepository;
  private constructor() {}
  static getInstance() {
    return (this.instance ??= new PlatformLegalPolicyReadRepository());
  }
  private actor(principal: IamPrincipal) {
    return platformManagementGroupSnapshot(principal, Permission.LEGAL_POLICY_READ);
  }
  async scan(principal: IamPrincipal, after?: string) {
    await this.actor(principal);
    if (after !== undefined && !isLegalPolicyVersionId(after)) throw iamAccountDenied();
    return prisma.legalPolicyVersion.findMany({
      where: { status: 1, ...(after ? { id: { gt: after } } : {}) },
      select: metadata,
      orderBy: { id: "asc" },
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  async target(principal: IamPrincipal, id: string) {
    await this.actor(principal);
    if (!isLegalPolicyVersionId(id)) throw iamAccountDenied();
    return prisma.legalPolicyVersion.findFirst({ where: { id, status: 1 }, select: metadata });
  }
  private where(targets: readonly LegalPolicyReadTarget[]): Prisma.LegalPolicyVersionWhereInput {
    if (
      !targets.length ||
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      targets.some((t) => !isLegalPolicyVersionId(t.id) || t.status !== 1)
    )
      throw iamAccountDenied();
    return {
      status: 1,
      OR: targets.map((t) => ({ id: t.id, updateTime: t.updateTime, policyType: t.policyType, version: t.version })),
    };
  }
  async recheck(principal: IamPrincipal, targets: readonly LegalPolicyReadTarget[]) {
    await this.actor(principal);
    return targets.length ? prisma.legalPolicyVersion.findMany({ where: this.where(targets), select: metadata }) : [];
  }
  async summaries(principal: IamPrincipal, targets: readonly LegalPolicyReadTarget[]) {
    await this.actor(principal);
    return targets.length ? prisma.legalPolicyVersion.findMany({ where: this.where(targets), select: summary }) : [];
  }
  async detail(principal: IamPrincipal, target: LegalPolicyReadTarget) {
    await this.actor(principal);
    return prisma.legalPolicyVersion.findFirst({ where: this.where([target]) });
  }
}
