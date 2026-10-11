import { performance } from "node:perf_hooks";
import type { IamPrincipal } from "@quyan/shared";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { carpoolArn, isCanonicalCarpoolId } from "@/iam/resources/carpool-resources";
import { CarpoolRepository, type CarpoolMemberOrderTarget } from "@/store/billing/carpool.repository";
import { carpoolPageQuerySchema } from "@/api/schema/billing/carpool.schema";
import type { TypedRequest } from "@/types/express";
import { BadRequestError, ForbiddenError } from "@/util/errors";

const denied = () =>
  new ForbiddenError("Carpool member resource authorization unavailable", undefined, {
    messageKey: "permission.insufficientPermission",
  });

/** Membership narrows storage candidates; IAM then narrows the visible order population. */
export class CarpoolOrderIamService {
  private static instance: CarpoolOrderIamService;
  private constructor(
    private readonly repository: Pick<
      CarpoolRepository,
      "scanMemberOrderTargets" | "readMemberOrderTargets"
    > = CarpoolRepository.getInstance(),
    private readonly iam = IamAuthorizationService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new CarpoolOrderIamService());
  }

  private async filter(request: TypedRequest, principal: IamPrincipal, targets: readonly CarpoolMemberOrderTarget[]) {
    if (!targets.length) return [];
    if (
      targets.some(
        (target) =>
          !isCanonicalCarpoolId(target.id) ||
          !target.members.some((member) => member.userId === principal.subjectUserId),
      )
    )
      throw denied();
    const action = "quyan:carpool:ListMyOrders";
    const resources = targets.map((target) => carpoolArn(principal.accountOwnerId, "order", target.id));
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

  async list(userId: string, page: number, pageSize: number, state?: string, keyword?: string, request?: TypedRequest) {
    const parsed = carpoolPageQuerySchema.safeParse({ page, pageSize, state, keyword });
    if (!parsed.success || !Number.isSafeInteger((page - 1) * pageSize))
      throw new BadRequestError("Invalid carpool list query", undefined, { messageKey: "errors.validationFailed" });
    const principal = request && getIamPrincipal(request);
    if (!request || !principal || principal.subjectUserId !== userId || principal.principalUserId !== userId)
      throw denied();
    await this.iam.loadPolicies(principal);
    let total = 0,
      after: CarpoolMemberOrderTarget | undefined;
    const selected: CarpoolMemberOrderTarget[] = [];
    while (true) {
      const targets = await this.repository.scanMemberOrderTargets(
        userId,
        principal.accountOwnerId,
        parsed.data.state,
        parsed.data.keyword,
        after,
      );
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
    if ((await this.filter(request, principal, selected)).length !== selected.length) throw denied();
    await this.iam.loadPolicies(principal);
    const records = await this.repository.readMemberOrderTargets(userId, principal.accountOwnerId, selected);
    if (records.length !== selected.length) throw denied();
    const byId = new Map(records.map((record) => [record.id, record]));
    if (byId.size !== selected.length) throw denied();
    return {
      total,
      records: selected.map((target) => {
        const record = byId.get(target.id);
        if (
          !record ||
          record.updateTime.getTime() !== target.updateTime.getTime() ||
          !record.members.some((member) => member.userId === userId)
        )
          throw denied();
        return record;
      }),
    };
  }
}
