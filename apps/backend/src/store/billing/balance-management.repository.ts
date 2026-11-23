import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import {
  BALANCE_MANAGEMENT_POLICY,
  DEFAULT_BALANCE_OVERDRAFT_CATEGORIES,
  DEFAULT_BALANCE_OVERDRAFT_RULE,
} from "@quyan/shared";
import { prisma } from "@/config/database";
import { BadRequestError, ConflictError, NotFoundError } from "@/util/errors";
import { lockBalanceAccounts, lockBalanceAccount, applyBalanceAccountMutation } from "./balance-account-mutation";
import type {
  AdjustBalanceAccountRequest,
  BalanceAdjustmentResultDto,
  SetDefaultOverdraftRequest,
  SetUserOverdraftRequest,
} from "@/api/dto/billing/balance-management.dto";
import type { BalanceManagementGuard } from "@/services/billing/balance-management-iam.service";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import type { buildBusinessLogRequestContext } from "@/util/business-log-context";
import { calculateOverdraftLimit } from "@/util/balance-overdraft-formula";
import { calculateAccountAdjustment } from "@/util/balance-account-adjustment";
import { overdraftRuleSchema } from "@/api/schema/billing/balance-management.schema";

type Audit = ReturnType<typeof buildBusinessLogRequestContext>;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const conflict = () =>
  new ConflictError("Account or policy changed", undefined, { messageKey: "billing.accountChanged" });
const invalid = () =>
  new BadRequestError("Invalid adjustment result", undefined, { messageKey: "billing.invalidAdjustment" });
export class BalanceManagementRepository {
  private static instance: BalanceManagementRepository;
  static getInstance() {
    return (this.instance ??= new BalanceManagementRepository());
  }
  async scan(userId?: string, after?: string) {
    return prisma.user.findMany({
      where: { status: { in: [0, 1] }, id: { ...(userId ? { equals: userId } : {}), ...(after ? { gt: after } : {}) } },
      select: { id: true, username: true, balanceAccount: true },
      orderBy: { id: "asc" },
      take: BALANCE_MANAGEMENT_POLICY.batchSize,
    });
  }
  async targets(ids: string[]) {
    return prisma.user.findMany({
      where: { id: { in: ids }, status: { in: [0, 1] } },
      select: { id: true, username: true, balanceAccount: true },
      orderBy: { id: "asc" },
    });
  }
  async identitiesByUsernames(usernames: string[]) {
    return prisma.user.findMany({
      where: { username: { in: usernames }, status: { in: [0, 1] } },
      select: { id: true, username: true },
      take: BALANCE_MANAGEMENT_POLICY.batchSize,
    });
  }
  private async lockDefaults(tx: Prisma.TransactionClient) {
    await tx.balanceOverdraftDefault.upsert({
      where: { id: BALANCE_MANAGEMENT_POLICY.defaultId },
      create: {
        id: BALANCE_MANAGEMENT_POLICY.defaultId,
        rule: json(DEFAULT_BALANCE_OVERDRAFT_RULE),
        categories: json(DEFAULT_BALANCE_OVERDRAFT_CATEGORIES),
      },
      update: {},
    });
    await tx.$queryRaw`SELECT id FROM balance_overdraft_defaults WHERE id=${BALANCE_MANAGEMENT_POLICY.defaultId} FOR UPDATE`;
    return tx.balanceOverdraftDefault.findUniqueOrThrow({ where: { id: BALANCE_MANAGEMENT_POLICY.defaultId } });
  }
  private async lockTargets(tx: Prisma.TransactionClient, ids: string[], guard: BalanceManagementGuard) {
    const allIds = [...new Set([...guard.identityUserIds, ...ids])].sort();
    await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(allIds)}) ORDER BY id FOR UPDATE`);
    const users = await tx.user.findMany({ where: { id: { in: ids }, status: { in: [0, 1] } }, select: { id: true } });
    if (users.length !== ids.length)
      throw new NotFoundError("User unavailable", undefined, { messageKey: "user.notFound" });
    await guard.recheck(tx);
  }
  private async audit(
    tx: Prisma.TransactionClient,
    guard: BalanceManagementGuard,
    audit: Audit,
    changes: unknown,
    userId?: string,
    adjustment = false,
  ) {
    await BusinessLogService.getInstance().logOperation(
      {
        operationType: adjustment ? OperationType.BALANCE_ACCOUNT_ADJUST : OperationType.BALANCE_OVERDRAFT_UPDATE,
        operationCategory: OperationCategory.BILLING,
        actorUserId: guard.actorUserId,
        targetUserId: userId,
        targetResourceType: "BALANCE_ACCOUNT",
        description: adjustment ? "Administrative balance account correction" : "Overdraft policy update",
        changes,
        success: true,
        ...audit,
      },
      tx,
    );
  }
  async saveDefaults(body: SetDefaultOverdraftRequest, guard: BalanceManagementGuard, audit: Audit) {
    return prisma.$transaction(
      async (tx) => {
        await this.lockTargets(tx, [], guard);
        const current = await this.lockDefaults(tx);
        if (current.version !== body.version) throw conflict();
        const updated = await tx.balanceOverdraftDefault.update({
          where: { id: current.id },
          data: { rule: json(body.rule), categories: json(body.categories), version: { increment: 1 } },
        });
        await this.audit(tx, guard, audit, { before: current, after: updated });
        await guard.recheck(tx);
        return updated.version;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async saveUsers(body: SetUserOverdraftRequest, guard: BalanceManagementGuard, audit: Audit) {
    return prisma.$transaction(
      async (tx) => {
        const ids = body.targets.map((row) => row.userId).sort();
        await this.lockTargets(tx, ids, guard);
        const defaults = await this.lockDefaults(tx);
        if (defaults.version !== body.defaultVersion) throw conflict();
        const accounts = await lockBalanceAccounts(
          tx,
          ids.map((userId) => ({ userId, createIfMissing: true })),
        );
        for (const target of body.targets) {
          const account = accounts.get(target.userId);
          if (!account || account.status !== 1 || account.overdraftVersion !== target.version) throw conflict();
          const rule =
            body.rule === undefined ? (account.overdraftRule ?? defaults.rule) : (body.rule ?? defaults.rule);
          try {
            calculateOverdraftLimit(overdraftRuleSchema.parse(rule), account);
          } catch {
            throw new BadRequestError("Rule failed for target", undefined, {
              messageKey: "billing.invalidOverdraftRule",
            });
          }
          const updated = await tx.balanceAccount.update({
            where: { userId: target.userId },
            data: {
              ...(body.rule === undefined
                ? {}
                : { overdraftRule: body.rule === null ? Prisma.DbNull : json(body.rule) }),
              ...(body.categories === undefined
                ? {}
                : { overdraftCategories: body.categories === null ? Prisma.DbNull : json(body.categories) }),
              overdraftVersion: { increment: 1 },
            },
          });
          await this.audit(
            tx,
            guard,
            audit,
            {
              before: { rule: account.overdraftRule, categories: account.overdraftCategories },
              after: { rule: updated.overdraftRule, categories: updated.overdraftCategories },
            },
            target.userId,
          );
        }
        await guard.recheck(tx);
        return { updated: ids.length };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 },
    );
  }
  async adjust(
    body: AdjustBalanceAccountRequest,
    guard: BalanceManagementGuard,
    audit: Audit,
  ): Promise<BalanceAdjustmentResultDto> {
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          actor: guard.actorUserId,
          userId: body.userId,
          reason: body.reason,
          balance: body.balance,
          totalRecharged: body.totalRecharged,
          totalUsed: body.totalUsed,
        }),
      )
      .digest("hex");
    return prisma.$transaction(
      async (tx) => {
        await this.lockTargets(tx, [body.userId], guard);
        const account = await lockBalanceAccount(tx, body.userId, true);
        if (!account || account.status !== 1) throw invalid();
        const previous = await tx.balanceAccountAdjustment.findUnique({ where: { operationId: body.operationId } });
        if (previous) {
          if (previous.requestHash !== requestHash || previous.actorUserId !== guard.actorUserId) throw conflict();
          await guard.recheck(tx);
          return {
            operationId: body.operationId,
            userId: body.userId,
            before: previous.before as BalanceAdjustmentResultDto["before"],
            after: previous.after as BalanceAdjustmentResultDto["after"],
          };
        }
        const before = {
          balance: Number(account.balance),
          totalRecharged: Number(account.totalRecharged),
          totalUsed: Number(account.totalUsed),
        };
        const after = calculateAccountAdjustment(before, body);
        const mutation = await applyBalanceAccountMutation(tx, {
          userId: body.userId,
          balanceDelta: new Decimal(after.balance).minus(before.balance),
          totalRechargedDelta: new Decimal(after.totalRecharged).minus(before.totalRecharged),
          totalUsedDelta: new Decimal(after.totalUsed).minus(before.totalUsed),
          requireActive: true,
        });
        if (!mutation) throw invalid();
        const entry = await tx.balanceAccountAdjustment.create({
          data: {
            operationId: body.operationId,
            userId: body.userId,
            actorUserId: guard.actorUserId,
            requestHash,
            reason: body.reason,
            before: json(before),
            after: json(after),
          },
        });
        await tx.balanceTransaction.create({
          data: {
            userId: body.userId,
            type: "account_adjustment",
            amount: new Decimal(after.balance).minus(before.balance),
            balanceBefore: mutation.balanceBefore,
            balanceAfter: mutation.balanceAfter,
            relatedId: entry.id,
            description: body.reason,
          },
        });
        await this.audit(
          tx,
          guard,
          audit,
          { before, after, reason: body.reason, operationId: body.operationId },
          body.userId,
          true,
        );
        await guard.recheck(tx);
        return { operationId: body.operationId, userId: body.userId, before, after };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
