import { buildAcsResource, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { monthlyPassTemplateArn, monthlyPassAssignmentArn } from "@/iam/resources/monthly-pass-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IamAccountUserRepository, iamAccountDenied } from "@/store/users/iam-account-principal";
import { MonthlyPassRepository } from "@/store/billing/monthly-pass.repository";
import type { MonthlyPassStore } from "@/store/billing/monthly-pass.store";
import { monthlyPassTemplateRevision } from "@/store/billing/monthly-pass-template-write";
import type { MonthlyPassPurchaseGuard } from "@/store/billing/monthly-pass-purchase";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const action = "quyan:monthly_pass:ClaimPublishedTemplate";
export class MonthlyPassPurchaseIamService {
  private static instance: MonthlyPassPurchaseIamService;
  static getInstance() {
    return (this.instance ??= new MonthlyPassPurchaseIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "authorize" | "loadPolicies"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: Pick<MonthlyPassStore, "findTemplateById"> = MonthlyPassRepository.getInstance(),
    private readonly users: Pick<IamAccountUserRepository, "targets"> = IamAccountUserRepository.getInstance(),
  ) {}
  private async evaluate(principal: IamPrincipal, request: TypedRequest, resource: string) {
    const start = performance.now();
    const result = await this.iam.authorize({
      principal,
      action,
      resource,
      context: requestConditionContext(request, principal),
    });
    if (!result) throw iamAccountDenied();
    (request.iamDecisions ??= []).push({ ...result, action, resource });
    auditIamDecision({
      requestId: request.res?.locals.requestId,
      principal,
      action,
      resource,
      result,
      evaluationLatencyMs: performance.now() - start,
      authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
      ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed: true } : {}),
    });
    if (result.decision !== "Allow") throw iamAccountDenied();
  }
  async prepare(userId: string, request: TypedRequest | undefined, templateId: string) {
    const mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode) || !isPlatformLogResourceId(templateId))
      throw iamAccountDenied();
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return undefined;
    }
    const principal = getIamPrincipal(request);
    if (
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== userId ||
      principal.principalUserId !== userId
    )
      throw iamAccountDenied();
    if (mode === "legacy") return undefined;
    const native = async () => {
      const ids = [...new Set([userId, principal.accountOwnerId])],
        snapshot = await this.users.targets(principal, ids),
        policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const recheck = async () => {
        const current = await this.users.targets(principal, ids);
        if (
          snapshot.length !== ids.length ||
          current.length !== ids.length ||
          current.some(
            (row) =>
              !snapshot.some((old) => row.id === old.id && row.updateTime.getTime() === old.updateTime.getTime()),
          ) ||
          fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies
        )
          throw iamAccountDenied();
        await this.evaluate(
          principal,
          request,
          buildAcsResource({
            service: "quyan",
            region: "*",
            accountId: principal.accountOwnerId,
            path: "user/" + userId,
          }),
        );
        await this.evaluate(principal, request, monthlyPassTemplateArn(principal.accountOwnerId, userId, templateId));
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
      };
      await recheck();
      const template = await this.repository.findTemplateById(templateId);
      if (
        !template ||
        template.id !== templateId ||
        template.status !== 1 ||
        template.publishStatus !== "published" ||
        !template.allowBalanceRedemption
      )
        throw iamAccountDenied();
      const templateHash = monthlyPassTemplateRevision(template);
      const guard: MonthlyPassPurchaseGuard = {
        template,
        users: {
          principal: { ...principal },
          targetUserId: userId,
          users: snapshot,
          recheck: async () => {
            if (monthlyPassTemplateRevision(guard.template) !== templateHash) throw iamAccountDenied();
            await recheck();
          },
        },
        recheckEntry: async (id) => {
          if (!isPlatformLogResourceId(id)) throw iamAccountDenied();
          await guard.users.recheck();
          await this.evaluate(principal, request, monthlyPassAssignmentArn(principal.accountOwnerId, userId, id));
          await guard.users.recheck();
        },
      };
      await guard.users.recheck();
      return { template, guard };
    };
    if (mode === "enforce") return native();
    try {
      await native();
    } catch {
      getLogger("MonthlyPassPurchaseIam", LogCategory.SECURITY).warn("Monthly pass purchase shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return undefined;
  }
}
