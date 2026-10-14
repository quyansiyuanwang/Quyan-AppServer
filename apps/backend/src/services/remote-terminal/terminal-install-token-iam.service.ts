import type { IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { remoteTerminalProductEntitlementArn, isRemoteTerminalId } from "@/iam/resources/remote-terminal-resources";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IamAccountUserRepository, iamAccountDenied } from "@/store/users/iam-account-principal";
import { TerminalInstallTokenRepository } from "@/store/remote-terminal-product/terminal-install-token.repository";
import type {
  TerminalInstallTokenStore,
  TerminalInstallGuard,
} from "@/store/remote-terminal-product/terminal-install-token.store";
import { issueInstallToken } from "@/modules/remote-terminal/install-token";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type { RemoteTerminalInstallTokenDto } from "@/api/dto/remote-terminal/remote-terminal.dto";
const action = "quyan:remote_terminal:GetMyInstallToken";
export class TerminalInstallTokenIamService {
  private static instance: TerminalInstallTokenIamService;
  static getInstance() {
    return (this.instance ??= new TerminalInstallTokenIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "authorize" | "loadPolicies"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: TerminalInstallTokenStore = TerminalInstallTokenRepository.getInstance(),
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
  async issue(
    userId: string,
    id: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<RemoteTerminalInstallTokenDto>,
  ) {
    const mode = env.security.iamAuthorizationMode;
    if (!isRemoteTerminalId(id) || !["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return legacy();
    }
    const principal = getIamPrincipal(request);
    if (
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== userId ||
      principal.principalUserId !== userId
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const native = async () => {
      const resource = remoteTerminalProductEntitlementArn(principal.accountOwnerId, userId, id);
      await this.evaluate(principal, request, resource);
      const target = await this.repository.target(principal, id);
      if (!target || target.id !== id || target.userId !== userId) throw iamAccountDenied();
      const ids = [...new Set([userId, principal.accountOwnerId])],
        snapshot = await this.users.targets(principal, ids);
      const policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
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
        await this.evaluate(principal, request, resource);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
      };
      await recheck();
      const guard: TerminalInstallGuard = {
        targetId: id,
        users: {
          principal: { ...principal },
          targetUserId: userId,
          users: snapshot,
          recheck: async () => {
            if (guard.targetId !== id) throw iamAccountDenied();
            await recheck();
          },
        },
      };
      return this.repository.issue(target, guard, () => {
        const secret = env.integrations.remoteTerminal.installTokenSecret;
        if (!secret || secret.length < 64) throw new Error("RTM_INSTALL_TOKEN_SECRET must be at least 64 characters");
        return issueInstallToken(id, secret);
      });
    };
    if (mode === "enforce") return native();
    try {
      await native();
    } catch {
      getLogger("TerminalInstallTokenIam", LogCategory.SECURITY).warn("Install token shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
}
