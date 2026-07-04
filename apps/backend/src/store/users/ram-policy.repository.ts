import { AccountStatus } from "@/util/auth/account-status";
import { prisma } from "@/config/database";
import type {
  CreateRamPolicyInput,
  PolicyAttachmentRecord,
  PolicyBindingInfo,
  PolicyBindingInfoWithTarget,
  RamPolicyStore,
  UpdateRamPolicyInput,
} from "./ram-policy.store";
import type { RamPolicy } from "@prisma/client";

const ACTIVE_WHERE = { status: AccountStatus.ACTIVE } as const;

export class RamPolicyRepository implements RamPolicyStore {
  private static instance: RamPolicyRepository;

  static getInstance(): RamPolicyRepository {
    if (!RamPolicyRepository.instance) RamPolicyRepository.instance = new RamPolicyRepository();
    return RamPolicyRepository.instance;
  }

  async createPolicy(data: CreateRamPolicyInput): Promise<RamPolicy> {
    return prisma.ramPolicy.create({
      data: {
        accountOwnerId: data.accountOwnerId,
        name: data.name,
        description: data.description ?? null,
        permissions: data.permissions,
        type: data.type ?? "custom",
        status: AccountStatus.ACTIVE,
      },
    });
  }

  async findPolicyById(policyId: string): Promise<RamPolicy | null> {
    return prisma.ramPolicy.findFirst({ where: { id: policyId, ...ACTIVE_WHERE } });
  }

  async findPolicyByName(accountOwnerId: string, name: string): Promise<RamPolicy | null> {
    return prisma.ramPolicy.findFirst({ where: { accountOwnerId, name, ...ACTIVE_WHERE } });
  }

  async listPolicies(accountOwnerId: string): Promise<RamPolicy[]> {
    return prisma.ramPolicy.findMany({ where: { accountOwnerId, ...ACTIVE_WHERE }, orderBy: { createTime: "desc" } });
  }

  async updatePolicy(policyId: string, data: UpdateRamPolicyInput): Promise<RamPolicy> {
    return prisma.ramPolicy.update({ where: { id: policyId }, data });
  }

  async softDeletePolicy(policyId: string): Promise<RamPolicy> {
    return prisma.ramPolicy.update({ where: { id: policyId }, data: { status: AccountStatus.DISABLED } });
  }

  async attachPolicy(accountOwnerId: string, policyId: string, targetType: string, targetId: string): Promise<void> {
    await prisma.ramPolicyAttachment.create({
      data: { accountOwnerId, policyId, targetType, targetId, status: AccountStatus.ACTIVE },
    });
  }

  async detachPolicy(policyId: string, targetType: string, targetId: string): Promise<void> {
    await prisma.ramPolicyAttachment.deleteMany({
      where: { policyId, targetType, targetId },
    });
  }

  async listAttachmentsByPolicy(policyId: string): Promise<PolicyAttachmentRecord[]> {
    const rows = await prisma.ramPolicyAttachment.findMany({
      where: { policyId, ...ACTIVE_WHERE },
      include: { policy: { select: { name: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      policyId: row.policyId,
      policyName: row.policy.name,
      targetType: row.targetType,
      targetId: row.targetId,
      targetName: null,
      createTime: row.createTime,
    }));
  }

  async listAttachmentsByTarget(targetType: string, targetId: string): Promise<PolicyAttachmentRecord[]> {
    const rows = await prisma.ramPolicyAttachment.findMany({
      where: { targetType, targetId, ...ACTIVE_WHERE },
      include: { policy: { select: { name: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      policyId: row.policyId,
      policyName: row.policy.name,
      targetType: row.targetType,
      targetId: row.targetId,
      targetName: null,
      createTime: row.createTime,
    }));
  }

  async listPoliciesForTarget(targetType: string, targetId: string): Promise<PolicyBindingInfo[]> {
    const rows = await prisma.ramPolicyAttachment.findMany({
      where: { targetType, targetId, ...ACTIVE_WHERE },
      include: { policy: { select: { name: true, permissions: true } } },
    });
    return rows.map((row) => ({
      policyId: row.policyId,
      policyName: row.policy.name,
      permissions: Array.isArray(row.policy.permissions)
        ? row.policy.permissions.filter((p): p is string => typeof p === "string")
        : [],
    }));
  }

  async listPoliciesForTargets(targetType: string, targetIds: string[]): Promise<PolicyBindingInfoWithTarget[]> {
    if (targetIds.length === 0) return [];
    const rows = await prisma.ramPolicyAttachment.findMany({
      where: { targetType, targetId: { in: targetIds }, ...ACTIVE_WHERE },
      include: { policy: { select: { name: true, permissions: true } } },
    });
    return rows.map((row) => ({
      policyId: row.policyId,
      policyName: row.policy.name,
      permissions: Array.isArray(row.policy.permissions)
        ? row.policy.permissions.filter((p): p is string => typeof p === "string")
        : [],
      targetId: row.targetId,
    }));
  }
}
