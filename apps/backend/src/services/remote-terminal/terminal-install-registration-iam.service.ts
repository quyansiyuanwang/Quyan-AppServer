import type { IamInstallTokenCapability } from "@/modules/remote-terminal/install-token";
import { INSTALL_TOKEN_POLICY } from "@/modules/remote-terminal/install-token";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { IamAccountUserRepository, iamAccountDenied } from "@/store/users/iam-account-principal";
import { TerminalInstallRegistrationRepository } from "@/store/remote-terminal-product/terminal-install-registration.repository";
import type {
  TerminalInstallRegistrationGuard,
  TerminalInstallRegistrationInput,
  TerminalInstallRegistrationStore,
} from "@/store/remote-terminal-product/terminal-install-registration.store";
import { terminalInstallUserFingerprint } from "@/iam/resources/terminal-install-capability";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { remoteTerminalProductEntitlementArn } from "@/iam/resources/remote-terminal-resources";
import { requestConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import type { TypedRequest } from "@/types/express";
/** A signed capability always retains its IAM constraints, including after a rollout-mode rollback. */
export class TerminalInstallRegistrationIamService {
  private static instance: TerminalInstallRegistrationIamService;
  static getInstance() {
    return (this.instance ??= new TerminalInstallRegistrationIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "authorize" | "loadPolicies"
    > = IamAuthorizationService.getInstance(),
    private readonly users: Pick<IamAccountUserRepository, "targets"> = IamAccountUserRepository.getInstance(),
    private readonly repository: TerminalInstallRegistrationStore = TerminalInstallRegistrationRepository.getInstance(),
  ) {}
  async register(
    capability: IamInstallTokenCapability,
    input: TerminalInstallRegistrationInput,
    request?: TypedRequest,
  ) {
    if (!request) throw iamAccountDenied();
    const principal = capability.grant.principal;
    const ids = [...new Set([principal.subjectUserId, principal.accountOwnerId])];
    const snapshot = await this.users.targets(principal, ids);
    const action = "quyan:remote_terminal:GetMyInstallToken";
    const resource = remoteTerminalProductEntitlementArn(
      principal.accountOwnerId,
      principal.subjectUserId,
      capability.entitlementId,
    );
    const recheck = async () => {
      const age = Date.now() / 1000 - capability.issuedAt;
      if (age < -INSTALL_TOKEN_POLICY.clockSkewSeconds || age >= INSTALL_TOKEN_POLICY.ttlSeconds)
        throw iamAccountDenied();
      const current = await this.users.targets(principal, ids);
      if (
        current.length !== ids.length ||
        terminalInstallUserFingerprint(current) !== capability.grant.userFingerprint ||
        fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== capability.grant.policyFingerprint
      )
        throw iamAccountDenied();
      const started = performance.now();
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
        evaluationLatencyMs: performance.now() - started,
        authorizationMode: "enforce",
      });
      if (
        result.decision !== "Allow" ||
        fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== capability.grant.policyFingerprint
      )
        throw iamAccountDenied();
    };
    await recheck();
    const guard: TerminalInstallRegistrationGuard = {
      capability,
      users: { principal, targetUserId: principal.subjectUserId, users: snapshot, recheck },
    };
    return this.repository.register(input, guard);
  }
}
