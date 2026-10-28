import { performance } from "node:perf_hooks";
import type { IamPrincipal } from "@quyan/shared";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { balanceGiftCodeArn, isCanonicalBalanceId } from "@/iam/resources/balance-resources";
import { BalanceTransferRepository } from "@/store/billing/balance-transfer.repository";
import type { BalanceGiftCodeTarget, BalanceTransferStore } from "@/store/billing/balance-transfer.store";
import { balanceGiftCodeListQuerySchema } from "@/api/schema/billing/balance-transfer.schema";
import type { TypedRequest } from "@/types/express";
import { BadRequestError, ForbiddenError } from "@/util/errors";

const denied = () =>
  new ForbiddenError("Gift code resource authorization unavailable", undefined, {
    messageKey: "permission.insufficientPermission",
  });

/** List metadata first, authorize every record, then load only the selected codes. */
export class BalanceGiftCodeIamService {
  private static instance: BalanceGiftCodeIamService;
  private constructor(
    private readonly repository: Pick<
      BalanceTransferStore,
      "scanGiftCodeTargets" | "readGiftCodeTargets"
    > = BalanceTransferRepository.getInstance(),
    private readonly iam = IamAuthorizationService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new BalanceGiftCodeIamService());
  }

  private async filter(request: TypedRequest, principal: IamPrincipal, targets: readonly BalanceGiftCodeTarget[]) {
    if (!targets.length) return [];
    if (targets.some((target) => !isCanonicalBalanceId(target.id) || target.createdBy !== principal.subjectUserId))
      throw denied();
    const action = "quyan:balance:ListGiftCodes";
    const resources = targets.map((target) =>
      balanceGiftCodeArn(principal.accountOwnerId, target.createdBy, target.id),
    );
    const start = performance.now();
    const results = await this.iam.authorizeMany({
      principal,
      action,
      resources,
      context: requestConditionContext(request, principal),
    });
    if (results.length !== targets.length || resources.some((_, index) => !results[index])) throw denied();
    results.forEach((result, index) => {
      (request.iamDecisions ??= []).push({ ...result, action, resource: resources[index] });
      auditIamDecision({
        requestId: request.res?.locals.requestId,
        principal,
        action,
        resource: resources[index],
        result,
        evaluationLatencyMs: performance.now() - start,
        authorizationMode: "enforce",
        batchSize: targets.length,
        batchIndex: index,
      });
    });
    return targets.filter((_, index) => results[index].decision === "Allow");
  }

  async list(senderId: string, page: number, pageSize: number, request?: TypedRequest) {
    const parsed = balanceGiftCodeListQuerySchema.safeParse({ page, pageSize });
    if (!parsed.success || !Number.isSafeInteger((page - 1) * pageSize))
      throw new BadRequestError("Invalid gift code pagination", undefined, { messageKey: "errors.validationFailed" });
    const principal = request && getIamPrincipal(request);
    if (!request || !principal || principal.subjectUserId !== senderId || principal.principalUserId !== senderId)
      throw denied();
    await this.iam.loadPolicies(principal);
    let total = 0,
      after: BalanceGiftCodeTarget | undefined;
    const selected: BalanceGiftCodeTarget[] = [];
    while (true) {
      const targets = await this.repository.scanGiftCodeTargets(senderId, principal.accountOwnerId, after);
      if (!targets.length) break;
      if (
        targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        targets.some((target, index) => {
          const previous = index ? targets[index - 1] : after;
          return (
            previous &&
            (target.createTime > previous.createTime ||
              (target.createTime.getTime() === previous.createTime.getTime() && target.id >= previous.id))
          );
        })
      )
        throw denied();
      const allowed = await this.filter(request, principal, targets);
      for (const target of allowed) {
        if (total >= (page - 1) * pageSize && selected.length < pageSize) selected.push(target);
        total++;
      }
      after = targets[targets.length - 1];
      if (targets.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
    }
    // A revoked grant during the scan cannot hydrate previously selected secrets.
    if ((await this.filter(request, principal, selected)).length !== selected.length) throw denied();
    await this.iam.loadPolicies(principal);
    const records = await this.repository.readGiftCodeTargets(senderId, principal.accountOwnerId, selected);
    if (records.length !== selected.length) throw denied();
    const byId = new Map(records.map((record) => [record.id, record]));
    if (byId.size !== selected.length) throw denied();
    return {
      total,
      records: selected.map((target) => {
        const record = byId.get(target.id);
        if (!record || record.createdBy !== senderId || record.updateTime.getTime() !== target.updateTime.getTime())
          throw denied();
        return record;
      }),
      page,
      pageSize,
    };
  }
}
