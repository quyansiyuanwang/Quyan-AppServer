import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { Permission, LEGAL_POLICY_TYPES, type IamPrincipal } from "@quyan/shared";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { iamAccountDenied } from "../users/iam-account-principal";
import { isLegalPolicyVersionId } from "@/iam/resources/platform-legal-policy-resources";
import { BadRequestError, ConflictError } from "@/util/errors";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type {
  PlatformLegalPolicyPublicationStore,
  LegalPolicyPublicationTransition,
  LegalPolicyPublicationGuard,
  LegalPolicyPublicationOperation,
} from "./platform-legal-policy-publication.store";
const metadata = {
  id: true,
  status: true,
  policyType: true,
  version: true,
  publishStatus: true,
  isCurrent: true,
  updateTime: true,
} as const;
export class PlatformLegalPolicyPublicationRepository implements PlatformLegalPolicyPublicationStore {
  private static instance: PlatformLegalPolicyPublicationRepository;
  private constructor() {}
  static getInstance() {
    return (this.instance ??= new PlatformLegalPolicyPublicationRepository());
  }
  private async transition(
    tx: Prisma.TransactionClient,
    id: string,
    operation: LegalPolicyPublicationOperation,
  ): Promise<LegalPolicyPublicationTransition> {
    if (!isLegalPolicyVersionId(id) || !["PublishVersion", "UnpublishVersion"].includes(operation))
      throw iamAccountDenied();
    const target = await tx.legalPolicyVersion.findFirst({ where: { id, status: 1 }, select: metadata });
    if (!target || !LEGAL_POLICY_TYPES.some((type) => type === target.policyType)) throw iamAccountDenied();
    const publishing = operation === "PublishVersion";
    if ((publishing && target.publishStatus !== "draft") || (!publishing && target.publishStatus !== "published"))
      throw new BadRequestError("Invalid legal policy publication state", undefined, {
        messageKey: publishing ? "legalPolicy.versionAlreadyPublished" : "legalPolicy.versionNotPublished",
      });
    let fallbackId: string | undefined;
    const affected = [target];
    if (publishing || target.isCurrent) {
      const current = await tx.legalPolicyVersion.findMany({
        where: { policyType: target.policyType, status: 1, isCurrent: true, id: { not: target.id } },
        select: metadata,
        take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
      });
      affected.push(...current);
    }
    if (!publishing && target.isCurrent) {
      const fallback = await tx.legalPolicyVersion.findFirst({
        where: { policyType: target.policyType, status: 1, publishStatus: "published", id: { not: target.id } },
        select: metadata,
        orderBy: { version: "desc" },
      });
      if (!fallback)
        throw new BadRequestError("Unpublishing would leave no active policy", undefined, {
          messageKey: "legalPolicy.unpublishWouldLeaveNoVersion",
        });
      fallbackId = fallback.id;
      if (!affected.some((t) => t.id === fallback.id)) affected.push(fallback);
    }
    if (affected.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) throw iamAccountDenied();
    affected.sort((a, b) => a.id.localeCompare(b.id));
    return { operation, target, affected, ...(fallbackId ? { fallbackId } : {}) };
  }
  async prepare(principal: IamPrincipal, id: string, operation: LegalPolicyPublicationOperation) {
    await platformManagementGroupSnapshot(principal, Permission.LEGAL_POLICY_PUBLISH);
    return this.transition(prisma, id, operation);
  }
  private async identity(tx: Prisma.TransactionClient, guard: LegalPolicyPublicationGuard) {
    if (guard.users.targetUserId !== guard.users.principal.subjectUserId) throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id = ${guard.group.id} FOR UPDATE`);
    const group = await platformManagementGroupSnapshot(guard.users.principal, Permission.LEGAL_POLICY_PUBLISH, tx);
    if (group.id !== guard.group.id || group.updateTime.getTime() !== guard.group.updateTime.getTime())
      throw iamAccountDenied();
  }
  private same(current: LegalPolicyPublicationTransition, expected: LegalPolicyPublicationTransition) {
    if (
      current.operation !== expected.operation ||
      current.target.id !== expected.target.id ||
      current.fallbackId !== expected.fallbackId ||
      current.affected.length !== expected.affected.length ||
      current.affected.some(
        (t) =>
          !expected.affected.some(
            (e) =>
              e.id === t.id &&
              e.status === t.status &&
              e.policyType === t.policyType &&
              e.version === t.version &&
              e.publishStatus === t.publishStatus &&
              e.isCurrent === t.isCurrent &&
              e.updateTime.getTime() === t.updateTime.getTime(),
          ),
      )
    )
      throw iamAccountDenied();
  }
  async commit(guard: LegalPolicyPublicationGuard) {
    const expected = guard.transition;
    if (
      !isLegalPolicyVersionId(expected.target.id) ||
      !LEGAL_POLICY_TYPES.some((type) => type === expected.target.policyType)
    )
      throw iamAccountDenied();
    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.identity(tx, guard);
          // Lock the complete type range: a concurrently published/fallback version changes the authorized set.
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM legal_policy_versions WHERE policyType = ${expected.target.policyType} ORDER BY id FOR UPDATE`,
          );
          const current = await this.transition(tx, expected.target.id, expected.operation);
          this.same(current, expected);
          await guard.users.recheck();
          const actor = guard.users.principal.subjectUserId;
          if (expected.operation === "PublishVersion") {
            const demoted = current.affected.filter((t) => t.id !== current.target.id && t.isCurrent).map((t) => t.id);
            if (demoted.length)
              await tx.legalPolicyVersion.updateMany({
                where: { id: { in: demoted } },
                data: { isCurrent: false, updatedBy: actor },
              });
            await tx.legalPolicyVersion.update({
              where: { id: current.target.id },
              data: { publishStatus: "published", isCurrent: true, publishedAt: new Date(), updatedBy: actor },
            });
          } else {
            await tx.legalPolicyVersion.update({
              where: { id: current.target.id },
              data: { publishStatus: "draft", isCurrent: false, publishedAt: null, updatedBy: actor },
            });
            if (current.fallbackId) {
              const demoted = current.affected
                .filter((t) => t.isCurrent && t.id !== current.target.id && t.id !== current.fallbackId)
                .map((t) => t.id);
              if (demoted.length)
                await tx.legalPolicyVersion.updateMany({
                  where: { id: { in: demoted } },
                  data: { isCurrent: false, updatedBy: actor },
                });
              await tx.legalPolicyVersion.update({
                where: { id: current.fallbackId },
                data: { isCurrent: true, updatedBy: actor },
              });
            }
          }
          await this.identity(tx, guard);
          return tx.legalPolicyVersion.findUniqueOrThrow({ where: { id: current.target.id } });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new ConflictError("Legal policy publication context changed", undefined, {
          messageKey: "errors.conflict",
        });
      throw error;
    }
  }
}
