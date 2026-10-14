import { buildAcsResource, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import {
  remoteTerminalPublishedTemplateArn,
  remoteTerminalProductEntitlementArn,
  isRemoteTerminalId,
} from "@/iam/resources/remote-terminal-resources";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IamAccountUserRepository, iamAccountDenied } from "@/store/users/iam-account-principal";
import {
  TerminalPurchaseRepository,
  terminalPurchaseTargetRevision,
} from "@/store/remote-terminal-product/terminal-purchase.repository";
import { terminalTemplateRevision } from "@/store/remote-terminal-product/platform-terminal-template-write.repository";
import type {
  TerminalPurchaseStore,
  TerminalPurchaseGuard,
} from "@/store/remote-terminal-product/terminal-purchase.store";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const action = "quyan:remote_terminal:ClaimPublishedTemplate";
export class TerminalPurchaseIamService {
  private static instance: TerminalPurchaseIamService;
  static getInstance() {
    return (this.instance ??= new TerminalPurchaseIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "authorize" | "loadPolicies"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: TerminalPurchaseStore = TerminalPurchaseRepository.getInstance(),
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
  async prepare(userId: string, request: TypedRequest | undefined, templateId: string, targetId?: string) {
    const mode = env.security.iamAuthorizationMode;
    if (
      !["legacy", "shadow", "enforce"].includes(mode) ||
      !isRemoteTerminalId(templateId) ||
      (targetId !== undefined && !isRemoteTerminalId(targetId))
    )
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
        await this.evaluate(
          principal,
          request,
          remoteTerminalPublishedTemplateArn(principal.accountOwnerId, userId, templateId),
        );
        if (targetId)
          await this.evaluate(
            principal,
            request,
            remoteTerminalProductEntitlementArn(principal.accountOwnerId, userId, targetId),
          );
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
      };
      await recheck();
      const template = await this.repository.template(principal, templateId),
        target = targetId ? await this.repository.target(principal, targetId) : null;
      if (
        !template ||
        template.id !== templateId ||
        template.status !== 1 ||
        template.publishStatus !== "published" ||
        (targetId &&
          (!target ||
            target.id !== targetId ||
            target.userId !== userId ||
            target.templateId !== templateId ||
            target.status !== 1))
      )
        throw iamAccountDenied();
      const templateHash = terminalTemplateRevision(template),
        targetHash = target ? terminalPurchaseTargetRevision(target) : null;
      const guard: TerminalPurchaseGuard = {
        template,
        target,
        users: {
          principal: { ...principal },
          targetUserId: userId,
          users: snapshot,
          recheck: async () => {
            if (
              terminalTemplateRevision(guard.template) !== templateHash ||
              (guard.target ? terminalPurchaseTargetRevision(guard.target) : null) !== targetHash
            )
              throw iamAccountDenied();
            await recheck();
          },
        },
        recheckEntry: async (id) => {
          await guard.users.recheck();
          await this.evaluate(
            principal,
            request,
            remoteTerminalProductEntitlementArn(principal.accountOwnerId, userId, id),
          );
          await guard.users.recheck();
        },
      };
      await guard.users.recheck();
      return { template, target, guard };
    };
    if (mode === "enforce") return native();
    try {
      await native();
    } catch {
      getLogger("TerminalPurchaseIam", LogCategory.SECURITY).warn("Terminal purchase shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return undefined;
  }
}
