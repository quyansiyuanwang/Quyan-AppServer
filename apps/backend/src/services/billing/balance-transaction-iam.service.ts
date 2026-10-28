import { performance } from "node:perf_hooks";
import type { BalanceTransaction } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import {
  balanceTransactionArn,
  isCanonicalBalanceTransactionId as validId,
} from "@/iam/resources/balance-transaction-resources";
import { BalanceTransactionManagementRepository } from "@/store/billing/balance-transaction-management.repository";
import type {
  BalanceTransactionManagementStore,
  ManagedTransactionQuery,
  ManagedTransactionTarget,
  ManagedTransactionDisplay,
} from "@/store/billing/balance-transaction-management.store";
import { iamAccountDenied as denied } from "@/store/users/iam-account-principal";
import { BadRequestError } from "@/util/errors";
import { BALANCE_TRANSACTION_POLICY } from "./balance-transaction-policy";
import type { TypedRequest } from "@/types/express";
const action = "quyan:balance:ListUserTransactions";
export class BalanceTransactionIamService {
  private static instance: BalanceTransactionIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: BalanceTransactionManagementStore = BalanceTransactionManagementRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new BalanceTransactionIamService());
  }
  private async allowed(principal: IamPrincipal, request: TypedRequest, targets: readonly ManagedTransactionTarget[]) {
    if (!targets.length) return new Set<string>();
    const resources = targets.map((row) => balanceTransactionArn(principal.accountOwnerId, row.userId, row.id)),
      start = performance.now(),
      results = await this.iam.authorizeMany({
        principal,
        action,
        resources,
        context: requestConditionContext(request, principal),
      });
    if (!Array.isArray(results) || results.length !== targets.length || targets.some((_, i) => !results[i]))
      throw denied();
    results.forEach((result, i) => {
      (request.iamDecisions ??= []).push({ ...result, action, resource: resources[i] });
      auditIamDecision({
        requestId: request.res?.locals.requestId,
        principal,
        action,
        resource: resources[i],
        result,
        evaluationLatencyMs: performance.now() - start,
        authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
        ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed: true } : {}),
      });
    });
    return new Set(targets.filter((_, i) => results[i].decision === "Allow").map((row) => row.id));
  }
  async list(input: ManagedTransactionQuery, request?: TypedRequest, diagnosticOnly = false) {
    const principal = request && getIamPrincipal(request);
    if (!request || !principal || principal.subjectUserId !== principal.principalUserId) throw denied();
    if (
      !Number.isSafeInteger(input.page) ||
      input.page < 1 ||
      !Number.isSafeInteger(input.pageSize) ||
      input.pageSize < 1 ||
      input.pageSize > 100 ||
      (input.userId !== undefined && !validId(input.userId)) ||
      [input.startTime, input.endTime].some(
        (date) => date && (!(date instanceof Date) || !Number.isFinite(date.getTime())),
      )
    )
      throw new BadRequestError("Invalid managed transaction query", undefined, { messageKey: "errors.badRequest" });
    const cutoff = new Date(Date.now() - BALANCE_TRANSACTION_POLICY.retentionWindowMs),
      query = { ...input, startTime: input.startTime && input.startTime > cutoff ? input.startTime : cutoff };
    await this.iam.loadPolicies(principal);
    await this.repository.assertActor(principal);
    const display: ManagedTransactionDisplay = {
      tokenNameMap: new Map(),
      usageDataMap: new Map(),
      transferDataMap: new Map(),
    };
    const rows: BalanceTransaction[] = [],
      targets: ManagedTransactionTarget[] = [],
      seen = new Set<string>();
    let after: ManagedTransactionTarget | undefined;
    if (!query.endTime || query.endTime >= query.startTime)
      while (true) {
        const page = await this.repository.scan(principal, query, after);
        if (!page.length) break;
        if (
          page.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
          page.some((row, i) => {
            const previous = i ? page[i - 1] : after;
            return (
              !validId(row.id) ||
              !validId(row.userId) ||
              seen.has(row.id) ||
              !(row.createTime instanceof Date) ||
              !Number.isFinite(row.createTime.getTime()) ||
              !(row.updateTime instanceof Date) ||
              !Number.isFinite(row.updateTime.getTime()) ||
              row.createTime < query.startTime ||
              (query.endTime && row.createTime > query.endTime) ||
              (query.userId !== undefined && row.userId !== query.userId) ||
              (previous &&
                (row.createTime > previous.createTime ||
                  (row.createTime.getTime() === previous.createTime.getTime() && row.id >= previous.id)))
            );
          })
        )
          throw denied();
        page.forEach((row) => seen.add(row.id));
        const permitted = await this.allowed(principal, request, page),
          selected = page.filter((row) => permitted.has(row.id));
        if (!diagnosticOnly && selected.length) {
          const views = await this.repository.hydrate(principal, selected);
          if (
            views.some(
              (row) =>
                !selected.some(
                  (t) =>
                    t.id === row.id && t.userId === row.userId && t.updateTime.getTime() === row.updateTime.getTime(),
                ),
            )
          )
            throw denied();
          const extra = await this.repository.display(principal, views);
          for (const [id, value] of extra.tokenNameMap) display.tokenNameMap.set(id, value);
          for (const [id, value] of extra.usageDataMap) display.usageDataMap.set(id, value);
          for (const [id, value] of extra.transferDataMap) display.transferDataMap.set(id, value);
          rows.push(...views);
          targets.push(...selected);
        }
        after = page[page.length - 1];
        if (page.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
      }
    const final = new Set<string>();
    for (let offset = 0; offset < targets.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const chunk = targets.slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
        permitted = await this.allowed(principal, request, chunk),
        current = await this.repository.current(principal, chunk);
      if (
        current.some(
          (row) =>
            !chunk.some(
              (t) => t.id === row.id && t.userId === row.userId && t.updateTime.getTime() === row.updateTime.getTime(),
            ),
        )
      )
        throw denied();
      current.filter((row) => permitted.has(row.id)).forEach((row) => final.add(row.id));
    }
    await this.repository.assertActor(principal);
    const visible = rows
      .filter(
        (row) =>
          final.has(row.id) &&
          (!input.tokenName || (row.relatedId && display.tokenNameMap.get(row.relatedId) === input.tokenName)),
      )
      .sort((a, b) => b.createTime.getTime() - a.createTime.getTime() || b.id.localeCompare(a.id));
    const records = visible.slice((input.page - 1) * input.pageSize, input.page * input.pageSize);
    const related = new Set(records.flatMap((row) => (row.relatedId ? [row.relatedId] : [])));
    for (const map of [display.tokenNameMap, display.usageDataMap, display.transferDataMap])
      for (const id of map.keys()) if (!related.has(id)) map.delete(id);
    return { records, total: visible.length, page: input.page, pageSize: input.pageSize, display };
  }
}
