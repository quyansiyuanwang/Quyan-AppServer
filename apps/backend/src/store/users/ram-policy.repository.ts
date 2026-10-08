import type { IamManagementPage } from "@/iam/management-pagination";
import { iamAuthorizationScopeKey } from "@/iam/authorization-scope";
import { RamAuthorizationRepository } from "./ram-authorization.repository";
import { AccountStatus } from "@/util/auth/account-status";
import { prisma } from "@/config/database";
import type {
  CreateRamPolicyInput,
  PolicyAttachmentRecord,
  PolicyBindingInfo,
  PolicyBindingInfoWithTarget,
  RamPolicyStore,
  RamPolicyWithVersion,
  UpdateRamPolicyInput,
} from "./ram-policy.store";
import type { Prisma, RamPolicyVersion } from "@prisma/client";
import { ConflictError } from "@/util/errors";
import type { IamVersionPagination } from "@/iam/policy-version-pagination";
import { parseIamPolicy } from "@/iam/parser/policy-parser";

const ACTIVE_WHERE = { status: AccountStatus.ACTIVE } as const;

export class RamPolicyRepository implements RamPolicyStore {
  private static instance: RamPolicyRepository;

  static getInstance(): RamPolicyRepository {
    if (!RamPolicyRepository.instance) RamPolicyRepository.instance = new RamPolicyRepository();
    return RamPolicyRepository.instance;
  }

  async createPolicy(data: CreateRamPolicyInput): Promise<RamPolicyWithVersion> {
    return prisma.$transaction(async (tx) => {
      const policy = await tx.ramPolicy.create({
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
      if (data.iamVersion) {
        const parsed = parseIamPolicy(data.iamVersion.document);
        if (parsed.documentHash !== data.iamVersion.documentHash) throw new Error("IAM document hash mismatch");
        const version = await tx.ramPolicyVersion.create({
          data: {
            policyId: policy.id,
            version: 1,
            document: parsed.document as unknown as Prisma.InputJsonValue,
            documentHash: parsed.documentHash,
            createdBy: data.iamVersion.createdBy,
          },
        });
        await tx.ramPolicy.update({
          where: { id: policy.id },
          data: { defaultVersionId: version.id, documentFormat: "iam-v1", validationState: "valid" },
        });
      }
      return tx.ramPolicy.findUniqueOrThrow({ where: { id: policy.id }, include: { defaultVersion: true } });
    });
  }
  async findPolicyById(policyId: string): Promise<RamPolicyWithVersion | null> {
    return prisma.ramPolicy.findFirst({ where: { id: policyId, ...ACTIVE_WHERE }, include: { defaultVersion: true } });
  }
  async findPolicyByName(accountOwnerId: string, name: string): Promise<RamPolicyWithVersion | null> {
    return prisma.ramPolicy.findFirst({
      where: { accountOwnerId, activeName: name, ...ACTIVE_WHERE },
      include: { defaultVersion: true },
    });
  }
  async listPolicies(accountOwnerId: string): Promise<RamPolicyWithVersion[]> {
    return prisma.ramPolicy.findMany({
      where: { accountOwnerId, ...ACTIVE_WHERE },
      include: { defaultVersion: true },
      orderBy: { createTime: "desc" },
    });
  }
  async listPoliciesPage(accountOwnerId: string, pagination: IamManagementPage) {
    const candidates = await prisma.ramPolicy.findMany({
      where: { accountOwnerId, ...ACTIVE_WHERE },
      include: { defaultVersion: true },
      orderBy: [{ createTime: "desc" }, { id: "asc" }],
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize + 1,
    });
    return {
      items: candidates.slice(0, pagination.pageSize),
      ...pagination,
      hasNext: candidates.length > pagination.pageSize,
    };
  }

  async updatePolicy(policyId: string, data: UpdateRamPolicyInput): Promise<RamPolicyWithVersion> {
    return prisma.$transaction(async (tx) => {
      const current = await tx.ramPolicy.findUniqueOrThrow({
        where: { id: policyId },
        include: { defaultVersion: true },
      });
      const { iamVersion, expectedDocumentHash, ...updates } = data;
      if (iamVersion && current.defaultVersion && expectedDocumentHash !== current.defaultVersion.documentHash)
        throw new ConflictError("IAM policy was modified concurrently", undefined, {
          messageKey: "iam.versionConflict",
        });
      // The pointer CAS serializes writes before allocating the next immutable version.
      const locked = await tx.ramPolicy.updateMany({
        where: { id: policyId, defaultVersionId: current.defaultVersionId },
        data: {
          ...updates,
          ...(updates.status !== undefined && updates.status !== AccountStatus.ACTIVE ? { activeName: null } : {}),
          updateTime: new Date(),
        },
      });
      if (locked.count !== 1)
        throw new ConflictError("IAM policy was modified concurrently", undefined, {
          messageKey: "iam.versionConflict",
        });
      if (iamVersion) {
        const parsed = parseIamPolicy(iamVersion.document);
        if (parsed.documentHash !== iamVersion.documentHash) throw new Error("IAM document hash mismatch");
        const max = await tx.ramPolicyVersion.aggregate({ where: { policyId }, _max: { version: true } });
        const version = await tx.ramPolicyVersion.create({
          data: {
            policyId,
            version: (max._max.version ?? 0) + 1,
            document: parsed.document as unknown as Prisma.InputJsonValue,
            documentHash: parsed.documentHash,
            createdBy: iamVersion.createdBy,
          },
        });
        await tx.ramPolicy.update({
          where: { id: policyId },
          data: { defaultVersionId: version.id, documentFormat: "iam-v1", validationState: "valid" },
        });
      }
      return tx.ramPolicy.findUniqueOrThrow({ where: { id: policyId }, include: { defaultVersion: true } });
    });
  }
  async listVersions(policyId: string, pagination: IamVersionPagination) {
    const where = { policyId, status: AccountStatus.ACTIVE };
    const [items, total] = await prisma.$transaction([
      prisma.ramPolicyVersion.findMany({
        where,
        orderBy: { version: "desc" },
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      }),
      prisma.ramPolicyVersion.count({ where }),
    ]);
    return { items, total };
  }
  async findVersion(policyId: string, versionId: string): Promise<RamPolicyVersion | null> {
    return prisma.ramPolicyVersion.findFirst({ where: { id: versionId, policyId, status: AccountStatus.ACTIVE } });
  }
  async setDefaultVersion(policyId: string, versionId: string, expectedDocumentHash: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const current = await tx.ramPolicy.findUniqueOrThrow({
        where: { id: policyId },
        include: { defaultVersion: true },
      });
      const target = await tx.ramPolicyVersion.findFirstOrThrow({
        where: { id: versionId, policyId, status: AccountStatus.ACTIVE, validationState: "valid" },
      });
      if (!current.defaultVersion || current.defaultVersion.documentHash !== expectedDocumentHash)
        throw new ConflictError("IAM policy was modified concurrently", undefined, {
          messageKey: "iam.versionConflict",
        });
      if (parseIamPolicy(target.document).documentHash !== target.documentHash)
        throw new Error("IAM document hash mismatch");
      const updated = await tx.ramPolicy.updateMany({
        where: { id: policyId, defaultVersionId: current.defaultVersionId },
        data: { defaultVersionId: versionId },
      });
      if (updated.count !== 1)
        throw new ConflictError("IAM policy was modified concurrently", undefined, {
          messageKey: "iam.versionConflict",
        });
    });
  }
  async softDeletePolicy(policyId: string): Promise<RamPolicyWithVersion> {
    return prisma.ramPolicy.update({
      where: { id: policyId },
      data: { status: AccountStatus.DISABLED, activeName: null },
    });
  }

  async attachPolicy(accountOwnerId: string, policyId: string, targetType: string, targetId: string): Promise<void> {
    await RamAuthorizationRepository.getInstance().create({
      accountOwnerId,
      policyId,
      principalType: targetType,
      principalId: targetId,
      scopeType: "account",
      scopeKey: iamAuthorizationScopeKey("account"),
      createdBy: accountOwnerId,
    });
  }
  async detachPolicy(policyId: string, targetType: string, targetId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.ramAuthorization.updateMany({
        where: {
          policyId,
          principalType: targetType,
          principalId: targetId,
          scopeType: "account",
          status: AccountStatus.ACTIVE,
        },
        data: { status: AccountStatus.DELETED },
      });
      await tx.ramPolicyAttachment.deleteMany({ where: { policyId, targetType, targetId } });
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
      where: { targetType, targetId, ...ACTIVE_WHERE, policy: ACTIVE_WHERE },
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
      where: { targetType, targetId, ...ACTIVE_WHERE, policy: ACTIVE_WHERE },
      include: { policy: { include: { defaultVersion: true } } },
    });
    return rows.map((row) => ({
      policyId: row.policyId,
      policyName: row.policy.name,
      accountOwnerId: row.policy.accountOwnerId,
      documentFormat: row.policy.documentFormat,
      versionId: row.policy.defaultVersion?.id,
      document:
        row.policy.defaultVersion?.policyId === row.policyId &&
        row.policy.defaultVersion.status === AccountStatus.ACTIVE &&
        row.accountOwnerId === row.policy.accountOwnerId
          ? row.policy.defaultVersion.document
          : undefined,
      legacyPermissions: row.accountOwnerId === row.policy.accountOwnerId ? row.policy.permissions : null,
      documentHash: row.policy.defaultVersion?.documentHash,
      validationState: row.policy.defaultVersion?.validationState,
      permissions: Array.isArray(row.policy.permissions)
        ? row.policy.permissions.filter((p): p is string => typeof p === "string")
        : [],
    }));
  }

  async listPoliciesForTargets(targetType: string, targetIds: string[]): Promise<PolicyBindingInfoWithTarget[]> {
    if (targetIds.length === 0) return [];
    const rows = await prisma.ramPolicyAttachment.findMany({
      where: { targetType, targetId: { in: targetIds }, ...ACTIVE_WHERE, policy: ACTIVE_WHERE },
      include: { policy: { include: { defaultVersion: true } } },
    });
    return rows.map((row) => ({
      policyId: row.policyId,
      policyName: row.policy.name,
      accountOwnerId: row.policy.accountOwnerId,
      documentFormat: row.policy.documentFormat,
      versionId: row.policy.defaultVersion?.id,
      document:
        row.policy.defaultVersion?.policyId === row.policyId &&
        row.policy.defaultVersion.status === AccountStatus.ACTIVE &&
        row.accountOwnerId === row.policy.accountOwnerId
          ? row.policy.defaultVersion.document
          : undefined,
      legacyPermissions: row.accountOwnerId === row.policy.accountOwnerId ? row.policy.permissions : null,
      documentHash: row.policy.defaultVersion?.documentHash,
      validationState: row.policy.defaultVersion?.validationState,
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
