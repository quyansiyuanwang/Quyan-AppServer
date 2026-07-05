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
        activeName: data.name,
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
    return prisma.ramPolicy.findFirst({ where: { accountOwnerId, activeName: name, ...ACTIVE_WHERE } });
  }

  async listPolicies(accountOwnerId: string): Promise<RamPolicy[]> {
    return prisma.ramPolicy.findMany({ where: { accountOwnerId, ...ACTIVE_WHERE }, orderBy: { createTime: "desc" } });
  }

  async updatePolicy(policyId: string, data: UpdateRamPolicyInput): Promise<RamPolicy> {
    const updateData = { ...data } as UpdateRamPolicyInput & { activeName?: string | null };
    if (data.status !== undefined && data.status !== AccountStatus.ACTIVE) {
      updateData.activeName = null;
    }
    return prisma.ramPolicy.update({ where: { id: policyId }, data: updateData });
  }

  async softDeletePolicy(policyId: string): Promise<RamPolicy> {
    return prisma.ramPolicy.update({ where: { id: policyId }, data: { status: AccountStatus.DISABLED, activeName: null } });
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
    const mapped = rows.map((row) => ({
      id: row.id,
      policyId: row.policyId,
      policyName: row.policy.name,
      targetType: row.targetType,
      targetId: row.targetId,
      targetName: null as string | null,
      createTime: row.createTime,
    }));
    const nameMap = await this.resolveTargetNames(mapped);
    for (const record of mapped) {
      record.targetName = nameMap.get(`${record.targetType}:${record.targetId}`) ?? null;
    }
    return mapped;
  }

  async listAttachmentsByTarget(targetType: string, targetId: string): Promise<PolicyAttachmentRecord[]> {
    const rows = await prisma.ramPolicyAttachment.findMany({
      where: { targetType, targetId, ...ACTIVE_WHERE },
      include: { policy: { select: { name: true } } },
    });
    const mapped = rows.map((row) => ({
      id: row.id,
      policyId: row.policyId,
      policyName: row.policy.name,
      targetType: row.targetType,
      targetId: row.targetId,
      targetName: null as string | null,
      createTime: row.createTime,
    }));
    const nameMap = await this.resolveTargetNames(mapped);
    for (const record of mapped) {
      record.targetName = nameMap.get(`${record.targetType}:${record.targetId}`) ?? null;
    }
    return mapped;
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

  private async resolveTargetNames(
    attachments: { targetType: string; targetId: string }[],
  ): Promise<Map<string, string>> {
    const userTargets: string[] = [];
    const roleTargets: string[] = [];
    const groupTargets: string[] = [];
    for (const a of attachments) {
      if (a.targetType === "user") userTargets.push(a.targetId);
      else if (a.targetType === "role") roleTargets.push(a.targetId);
      else if (a.targetType === "group") groupTargets.push(a.targetId);
    }

    const nameMap = new Map<string, string>();

    if (userTargets.length > 0) {
      const users = await prisma.user.findMany({
        where: { id: { in: [...new Set(userTargets)] } },
        select: { id: true, ramUsername: true, displayName: true },
      });
      for (const u of users) {
        nameMap.set(`user:${u.id}`, u.displayName || u.ramUsername || u.id);
      }
    }

    if (roleTargets.length > 0) {
      const roles = await prisma.ramRole.findMany({
        where: { id: { in: [...new Set(roleTargets)] } },
        select: { id: true, name: true },
      });
      for (const r of roles) {
        nameMap.set(`role:${r.id}`, r.name);
      }
    }

    if (groupTargets.length > 0) {
      const groups = await prisma.group.findMany({
        where: { id: { in: [...new Set(groupTargets)] } },
        select: { id: true, name: true },
      });
      for (const g of groups) {
        nameMap.set(`group:${g.id}`, g.name || g.id);
      }
    }

    return nameMap;
  }
}
