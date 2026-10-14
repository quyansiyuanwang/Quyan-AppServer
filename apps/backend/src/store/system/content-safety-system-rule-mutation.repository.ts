import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { CONTENT_SAFETY_RULE_LIMITS } from "@/constant/content-safety-rule";
import { isContentSafetyRuleId } from "@/iam/resources/content-safety-system-resources";
import { BadRequestError, ConflictError } from "@/util/errors";
import { iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import {
  readContentSafetySystemRuleTargets,
  contentSafetySystemRuleCollectionRevision,
  contentSafetySystemDefaultRuleTargets,
  sameContentSafetySystemRuleTargets,
} from "./content-safety-system-rule-snapshot";
import type {
  ContentSafetySystemRuleImportStore,
  ContentSafetySystemRuleImportGuard,
  ContentSafetySystemRuleImportOperation,
  ContentSafetySystemRuleMutationGuard,
  ContentSafetySystemRuleData,
  ContentSafetySystemRuleChanges,
} from "./content-safety-system-rule-mutation.store";
const transactionPolicy = Object.freeze({ timeoutMs: 30000 });
export class ContentSafetySystemRuleMutationRepository implements ContentSafetySystemRuleImportStore {
  private static instance: ContentSafetySystemRuleMutationRepository;
  static getInstance() {
    return (this.instance ??= new ContentSafetySystemRuleMutationRepository());
  }
  targets(ids: readonly string[]) {
    return readContentSafetySystemRuleTargets(prisma, ids);
  }
  async authorizationRevision(principal: IamPrincipal) {
    await platformManagementGroupSnapshot(principal, Permission.SYSTEM_CONFIG);
    return readIamAuthorizationRevision(prisma, principal.accountOwnerId);
  }
  private async identity(tx: Prisma.TransactionClient, guard: ContentSafetySystemRuleMutationGuard) {
    await assertIamAccountUserMutation(tx, guard.users, guard.users.principal.subjectUserId);
    const group = await platformManagementGroupSnapshot(guard.users.principal, Permission.SYSTEM_CONFIG, tx);
    if (
      group.id !== guard.group.id ||
      group.updateTime.getTime() !== guard.group.updateTime.getTime() ||
      (await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId)) !== guard.authorizationRevision
    )
      throw iamAccountDenied();
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id=${group.id} FOR UPDATE`);
  }
  private async budget(tx: Prisma.TransactionClient) {
    const rows = await tx.$queryRaw<{ count: bigint; bytes: Prisma.Decimal | bigint }[]>(
      Prisma.sql`SELECT COUNT(*) AS count,COALESCE(SUM(OCTET_LENGTH(pattern)),0) AS bytes FROM content_safety_rules WHERE status=1`,
    );
    return { count: Number(rows[0]!.count), bytes: Number(rows[0]!.bytes) };
  }
  private async transaction<T>(
    guard: ContentSafetySystemRuleMutationGuard,
    mutate: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.identity(tx, guard);
          if (guard.targets.length)
            sameContentSafetySystemRuleTargets(
              await readContentSafetySystemRuleTargets(
                tx,
                guard.targets.map((row) => row.id),
                true,
              ),
              guard.targets,
            );
          if (
            "sourceRevision" in guard &&
            (await contentSafetySystemRuleCollectionRevision(tx, true)) !== guard.sourceRevision
          )
            throw iamAccountDenied();
          const before = await this.budget(tx);
          const result = await mutate(tx);
          const after = await this.budget(tx);
          // Existing over-budget databases remain repairable; mutations cannot worsen either over-limit dimension.
          if (
            (after.count > CONTENT_SAFETY_RULE_LIMITS.maxRules && after.count > before.count) ||
            (after.bytes > CONTENT_SAFETY_RULE_LIMITS.maxPatternBytes && after.bytes > before.bytes)
          )
            throw new BadRequestError("Content safety rule limit reached", undefined, {
              messageKey: "contentSafety.ruleLimitReached",
            });
          await this.identity(tx, guard);
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: transactionPolicy.timeoutMs },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code))
        throw new ConflictError("Rule or authorization changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
  collectionRevision() {
    return contentSafetySystemRuleCollectionRevision(prisma);
  }
  defaultTargets(patterns: readonly string[]) {
    return contentSafetySystemDefaultRuleTargets(prisma, patterns);
  }
  async applyImport(
    guard: ContentSafetySystemRuleImportGuard,
    operations: readonly ContentSafetySystemRuleImportOperation[],
  ) {
    const updates = operations.filter((item) => item.operation === "update");
    if (
      !/^[a-f0-9]{64}$/.test(guard.sourceRevision) ||
      operations.length > CONTENT_SAFETY_RULE_LIMITS.maxRules ||
      operations.some(
        (item) => !["create", "update"].includes(item.operation) || !["csv", "default"].includes(item.source),
      ) ||
      updates.some((item) => !item.id || !guard.targets.some((target) => target.id === item.id)) ||
      new Set(updates.map((item) => item.id)).size !== updates.length
    )
      throw iamAccountDenied();
    await this.transaction(guard, async (tx) => {
      for (const item of operations) {
        const { name, type, pattern, direction, action, enabled, priority } = item.data;
        const data = { name, type, pattern, direction, action, enabled, priority, source: item.source };
        if (item.operation === "create") {
          if (item.id !== undefined) throw iamAccountDenied();
          const row = await tx.contentSafetyRule.create({ data: { ...data, ownerUserId: null, status: 1 } });
          await guard.authorizeCreated(row.id);
        } else {
          await tx.contentSafetyRule.update({ where: { id: item.id! }, data });
        }
      }
    });
  }
  create(guard: ContentSafetySystemRuleMutationGuard, data: ContentSafetySystemRuleData) {
    if (guard.targets.length) throw iamAccountDenied();
    return this.transaction(guard, async (tx) => {
      const row = await tx.contentSafetyRule.create({
        data: { ...data, ownerUserId: null, source: "custom", status: 1 },
      });
      if (!isContentSafetyRuleId(row.id) || row.ownerUserId !== null || row.status !== 1) throw iamAccountDenied();
      await guard.authorizeCreated(row.id);
      return row;
    });
  }
  update(guard: ContentSafetySystemRuleMutationGuard, data: ContentSafetySystemRuleData) {
    if (guard.targets.length !== 1) throw iamAccountDenied();
    return this.transaction(guard, (tx) => tx.contentSafetyRule.update({ where: { id: guard.targets[0]!.id }, data }));
  }
  async remove(guard: ContentSafetySystemRuleMutationGuard) {
    if (guard.targets.length !== 1) throw iamAccountDenied();
    await this.transaction(guard, (tx) =>
      tx.contentSafetyRule.update({ where: { id: guard.targets[0]!.id }, data: { status: 0, enabled: false } }),
    );
  }
  batch(guard: ContentSafetySystemRuleMutationGuard, changes: ContentSafetySystemRuleChanges) {
    if (!guard.targets.length) throw iamAccountDenied();
    return this.transaction(guard, async (tx) => {
      const result = await tx.contentSafetyRule.updateMany({
        where: { id: { in: guard.targets.map((row) => row.id) }, status: 1, ownerUserId: null },
        data: changes,
      });
      if (result.count !== guard.targets.length) throw iamAccountDenied();
      return { updated: result.count };
    });
  }
}
