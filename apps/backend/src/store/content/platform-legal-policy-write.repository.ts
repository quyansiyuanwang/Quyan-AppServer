import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { Permission, getIamActionDefinition, LEGAL_POLICY_TYPES, type IamPrincipal } from "@quyan/shared";
import { MANAGED_STATUS } from "@/constant/status";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { iamAccountDenied } from "../users/iam-account-principal";
import { BadRequestError, ConflictError } from "@/util/errors";
import { isLegalPolicyVersionId } from "@/iam/resources/platform-legal-policy-resources";
import {
  createLegalPolicyBodySchema,
  updateLegalPolicyBodySchema,
} from "@/api/schema/legal-policy/legal-policy.schema";
import type { CreateLegalPolicyDto, UpdateLegalPolicyDto } from "@/api/dto/legal-policy/legal-policy.dto";
import type {
  PlatformLegalPolicyWriteStore,
  PlatformLegalPolicyWriteGuard,
  LegalPolicyWriteTarget,
  LegalPolicyDraftOperation,
} from "./platform-legal-policy-write.store";
const metadata = {
  id: true,
  status: true,
  policyType: true,
  version: true,
  publishStatus: true,
  isCurrent: true,
  updateTime: true,
} as const;
export class PlatformLegalPolicyWriteRepository implements PlatformLegalPolicyWriteStore {
  private static instance: PlatformLegalPolicyWriteRepository;
  private constructor() {}
  static getInstance() {
    return (this.instance ??= new PlatformLegalPolicyWriteRepository());
  }
  async target(principal: IamPrincipal, id: string, permission: Permission) {
    if (
      !isLegalPolicyVersionId(id) ||
      ![Permission.LEGAL_POLICY_UPDATE, Permission.LEGAL_POLICY_DELETE].includes(permission)
    )
      throw iamAccountDenied();
    await platformManagementGroupSnapshot(principal, permission);
    return prisma.legalPolicyVersion.findFirst({ where: { id, status: MANAGED_STATUS.ENABLED }, select: metadata });
  }
  private async identity(
    tx: Prisma.TransactionClient,
    guard: PlatformLegalPolicyWriteGuard,
    operation: LegalPolicyDraftOperation,
  ) {
    const permission = getIamActionDefinition("quyan:legal_policy:" + operation)?.legacyPermission;
    if (
      !permission ||
      guard.operation !== operation ||
      guard.permission !== permission ||
      guard.users.targetUserId !== guard.users.principal.subjectUserId
    )
      throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id = ${guard.group.id} FOR UPDATE`);
    const current = await platformManagementGroupSnapshot(guard.users.principal, permission, tx);
    if (current.id !== guard.group.id || current.updateTime.getTime() !== guard.group.updateTime.getTime())
      throw iamAccountDenied();
  }
  private async transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new ConflictError("Legal policy context changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
  async create(input: CreateLegalPolicyDto, guard: PlatformLegalPolicyWriteGuard) {
    const parsed = createLegalPolicyBodySchema.strict().safeParse(input);
    if (!parsed.success) throw iamAccountDenied();
    return this.transaction(async (tx) => {
      await this.identity(tx, guard, "CreateVersion");
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM legal_policy_versions WHERE policyType = ${parsed.data.policyType} ORDER BY id FOR UPDATE`,
      );
      if (
        await tx.legalPolicyVersion.findFirst({
          where: { policyType: parsed.data.policyType, status: MANAGED_STATUS.ENABLED, publishStatus: "draft" },
          select: { id: true },
        })
      )
        throw new BadRequestError("An unpublished draft already exists", undefined, {
          messageKey: "legalPolicy.unpublishedDraftExists",
        });
      const latest = await tx.legalPolicyVersion.findFirst({
        where: { policyType: parsed.data.policyType },
        select: { version: true },
        orderBy: { version: "desc" },
      });
      const row = await tx.legalPolicyVersion.create({
        data: {
          ...parsed.data,
          version: (latest?.version ?? 0) + 1,
          contentFormat: "markdown",
          publishStatus: "draft",
          isCurrent: false,
          createdBy: guard.users.principal.subjectUserId,
        },
      });
      await guard.recheckVersion(row.id);
      await this.identity(tx, guard, "CreateVersion");
      await guard.recheckVersion(row.id);
      return row;
    });
  }
  private async draft(tx: Prisma.TransactionClient, target: LegalPolicyWriteTarget) {
    if (
      !isLegalPolicyVersionId(target.id) ||
      target.status !== MANAGED_STATUS.ENABLED ||
      !LEGAL_POLICY_TYPES.some((type) => type === target.policyType) ||
      !(target.updateTime instanceof Date)
    )
      throw iamAccountDenied();
    await tx.$queryRaw(Prisma.sql`SELECT id FROM legal_policy_versions WHERE id = ${target.id} FOR UPDATE`);
    const current = await tx.legalPolicyVersion.findUnique({ where: { id: target.id }, select: metadata });
    if (
      !current ||
      current.status !== MANAGED_STATUS.ENABLED ||
      current.policyType !== target.policyType ||
      current.version !== target.version ||
      current.publishStatus !== target.publishStatus ||
      current.isCurrent !== target.isCurrent ||
      current.updateTime.getTime() !== target.updateTime.getTime()
    )
      throw iamAccountDenied();
    if (current.publishStatus !== "draft" || current.isCurrent)
      throw new BadRequestError("Published versions cannot be changed", undefined, {
        messageKey: "legalPolicy.publishedVersionImmutable",
      });
    return current;
  }
  async update(target: LegalPolicyWriteTarget, input: UpdateLegalPolicyDto, guard: PlatformLegalPolicyWriteGuard) {
    const parsed = updateLegalPolicyBodySchema.safeParse(input);
    if (!parsed.success || Object.keys(input).some((key) => !["title", "summary", "content"].includes(key)))
      throw iamAccountDenied();
    return this.transaction(async (tx) => {
      await this.identity(tx, guard, "UpdateVersion");
      await this.draft(tx, target);
      await guard.recheckVersion(target.id);
      const row = await tx.legalPolicyVersion.update({
        where: { id: target.id },
        data: { ...parsed.data, updatedBy: guard.users.principal.subjectUserId },
      });
      await this.identity(tx, guard, "UpdateVersion");
      await guard.recheckVersion(target.id);
      return row;
    });
  }
  async remove(target: LegalPolicyWriteTarget, guard: PlatformLegalPolicyWriteGuard) {
    return this.transaction(async (tx) => {
      await this.identity(tx, guard, "DeleteVersion");
      await this.draft(tx, target);
      await guard.recheckVersion(target.id);
      const row = await tx.legalPolicyVersion.update({
        where: { id: target.id },
        data: { status: MANAGED_STATUS.DELETED, updatedBy: guard.users.principal.subjectUserId },
      });
      await this.identity(tx, guard, "DeleteVersion");
      await guard.recheckVersion(target.id);
      return row;
    });
  }
}
