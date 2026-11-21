import { Decimal } from "@prisma/client/runtime/library";
import type { BalanceAccount } from "@prisma/client";
import { BadRequestError, NotFoundError } from "@/util/errors";
import { BalanceManagementRepository } from "@/store/billing/balance-management.repository";
import { BalanceOverdraftRepository } from "@/store/billing/balance-overdraft.repository";
import { BalanceManagementIamService } from "./balance-management-iam.service";
import {
  managementQuerySchema,
  defaultOverdraftSchema,
  batchOverdraftSchema,
  previewOverdraftSchema,
  adjustAccountSchema,
} from "@/api/schema/billing/balance-management.schema";
import type {
  AdjustBalanceAccountRequest,
  ManagedBalanceAccountDto,
  PreviewOverdraftRequest,
  SetDefaultOverdraftRequest,
  SetUserOverdraftRequest,
} from "@/api/dto/billing/balance-management.dto";
import type { TypedRequest } from "@/types/express";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import { calculateAccountAdjustment } from "@/util/balance-account-adjustment";

export class BalanceManagementService {
  private static instance: BalanceManagementService;
  static getInstance() {
    return (this.instance ??= new BalanceManagementService());
  }
  private repository = BalanceManagementRepository.getInstance();
  private overdraft = BalanceOverdraftRepository.getInstance();
  private iam = BalanceManagementIamService.getInstance();
  private async project(
    row: { id: string; username: string; balanceAccount: BalanceAccount | null },
    override?: PreviewOverdraftRequest,
  ): Promise<ManagedBalanceAccountDto> {
    const original = row.balanceAccount;
    const account = {
      ...(original ?? {}),
      ...(override?.rule === undefined ? {} : { overdraftRule: override.rule }),
      ...(override?.categories === undefined ? {} : { overdraftCategories: override.categories }),
    } as Partial<BalanceAccount>;
    const policy = await this.overdraft.resolve(account);
    const used = Decimal.max(0, new Decimal(original?.balance ?? 0).negated());
    return {
      userId: row.id,
      username: row.username,
      balance: Number(original?.balance ?? 0),
      totalRecharged: Number(original?.totalRecharged ?? 0),
      totalUsed: Number(original?.totalUsed ?? 0),
      updateTime: original?.updateTime ?? null,
      rule: policy.rule,
      categories: policy.categories,
      ruleInherited: account.overdraftRule == null,
      categoriesInherited: account.overdraftCategories == null,
      version: original?.overdraftVersion ?? 0,
      defaultVersion: policy.defaultVersion,
      overdraftLimit: policy.limit.toNumber(),
      usedOverdraft: used.toNumber(),
      remainingOverdraft: Decimal.max(0, policy.limit.minus(used)).toNumber(),
      calculationError: policy.calculationError,
    };
  }
  async list(query: { page?: number; pageSize?: number; userId?: string }, request: TypedRequest) {
    const parsed = managementQuerySchema.parse(query);
    const guard = await this.iam.prepare("ListManagedAccounts", request);
    let after: string | undefined;
    let total = 0;
    const selected: Awaited<ReturnType<BalanceManagementRepository["scan"]>> = [];
    const start = (parsed.page - 1) * parsed.pageSize;
    for (;;) {
      const rows = await this.repository.scan(parsed.userId, after);
      const allowed = await guard.allowed(rows.map((row) => row.id));
      for (const row of rows)
        if (allowed.has(row.id)) {
          if (total >= start && selected.length < parsed.pageSize) selected.push(row);
          total++;
        }
      if (!rows.length) break;
      after = rows[rows.length - 1]!.id;
    }
    const records = await Promise.all(selected.map((row) => this.project(row)));
    await guard.recheck();
    return { records, total, page: parsed.page, pageSize: parsed.pageSize };
  }
  async defaults(request: TypedRequest) {
    const guard = await this.iam.prepare("GetOverdraftDefaults", request);
    const result = await this.overdraft.defaults();
    await guard.recheck();
    return result;
  }
  async saveDefaults(body: SetDefaultOverdraftRequest, request: TypedRequest) {
    const data = defaultOverdraftSchema.parse(body);
    const guard = await this.iam.prepare("SetOverdraftDefaults", request);
    await this.repository.saveDefaults(data, guard, buildBusinessLogRequestContext(request));
    return this.overdraft.defaults();
  }
  async saveUsers(body: SetUserOverdraftRequest, request: TypedRequest) {
    const data = batchOverdraftSchema.parse(body);
    const guard = await this.iam.prepare(
      "SetUserOverdraft",
      request,
      data.targets.map((row) => row.userId),
    );
    return this.repository.saveUsers(data, guard, buildBusinessLogRequestContext(request));
  }
  async preview(body: PreviewOverdraftRequest, request: TypedRequest) {
    const data = previewOverdraftSchema.parse(body);
    const ids = [...new Set(data.userIds)];
    const guard = await this.iam.prepare("PreviewOverdraft", request, ids);
    const rows = await this.repository.targets(ids);
    if (rows.length !== ids.length)
      throw new NotFoundError("User unavailable", undefined, { messageKey: "user.notFound" });
    const records = await Promise.all(rows.map((row) => this.project(row, data)));
    if (records.some((row) => row.calculationError))
      throw new BadRequestError("Overdraft formula failed for target", undefined, {
        messageKey: "billing.invalidOverdraftRule",
      });
    await guard.recheck();
    return records;
  }
  async adjust(body: AdjustBalanceAccountRequest, request: TypedRequest) {
    const data = adjustAccountSchema.parse(body);
    const guard = await this.iam.prepare("AdjustAccount", request, [data.userId]);
    return this.repository.adjust(data, guard, buildBusinessLogRequestContext(request));
  }
  async previewAdjustment(body: AdjustBalanceAccountRequest, request: TypedRequest) {
    const data = adjustAccountSchema.parse(body);
    const guard = await this.iam.prepare("PreviewAccountAdjustment", request, [data.userId]);
    const row = (await this.repository.targets([data.userId]))[0];
    if (!row) throw new NotFoundError("User unavailable", undefined, { messageKey: "user.notFound" });
    const before = await this.project(row);
    const values = calculateAccountAdjustment(before, data);
    const after = await this.project({
      ...row,
      balanceAccount: {
        ...(row.balanceAccount ?? {}),
        balance: new Decimal(values.balance),
        totalRecharged: new Decimal(values.totalRecharged),
        totalUsed: new Decimal(values.totalUsed),
      } as BalanceAccount,
    });
    await guard.recheck();
    return { before, after };
  }
}
