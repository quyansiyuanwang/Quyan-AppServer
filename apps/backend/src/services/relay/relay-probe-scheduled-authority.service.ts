import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { principalConditionContext, requestTransportConditionContext } from "@/iam/request/condition-context";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import { RelayProbeScheduledActorRepository } from "@/store/relay/relay-probe-scheduled-actor.repository";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { RelayChannelService } from "./relay-channel.service";
import type { RelayProbeMutationContext } from "@/store/relay/platform-relay-probe-mutation";
import type { TypedRequest } from "@/types/express";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";

/** Background identity comes from persisted users, never from a synthetic HTTP request or a stored JWT. */
export class RelayProbeScheduledAuthorityService {
  private static instance: RelayProbeScheduledAuthorityService;
  static getInstance() {
    return (this.instance ??= new RelayProbeScheduledAuthorityService());
  }
  constructor(
    private readonly actors = RelayProbeScheduledActorRepository.getInstance(),
    private readonly identities = PlatformManagementReadRepository.getInstance(),
    private readonly permissions = PermissionService.getInstance(),
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly channels = RelayChannelService.getInstance(),
  ) {}

  async context(
    actorUserId: string,
    action = "quyan:relay:CreateProbeRun",
    permission = Permission.RELAY_CHANNEL_PROBE_EXECUTE,
    request?: TypedRequest,
  ): Promise<RelayProbeMutationContext> {
    const principal = await this.actors.principal(actorUserId);
    if (request) this.assertRequest(principal, request);
    const mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    const snapshot = await this.identities.snapshot(principal, permission);
    const fingerprint = mode === "legacy" ? undefined : fingerprintIamPolicies(await this.iam.loadPolicies(principal));
    const registered = new Set<string>();
    const check = async (resources: readonly string[]) => {
      if (env.security.iamAuthorizationMode !== mode) throw iamAccountDenied();
      if (mode !== "enforce" && !(await this.permissions.checkUserPermissions(actorUserId, [permission])).hasPermission)
        throw iamAccountDenied();
      if (mode === "legacy" || !resources.length) return;
      // No HTTP conditions are manufactured for a scheduled task. Conditional policies must match its real context.
      for (let offset = 0; offset < resources.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
        const batch = resources.slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
        const results = await this.iam.authorizeMany({
          principal,
          action,
          resources: batch,
          context: {
            ...principalConditionContext(principal),
            ...(request ? requestTransportConditionContext(request) : {}),
          },
        });
        if (!Array.isArray(results) || results.length !== batch.length) throw iamAccountDenied();
        results.forEach((result, index) =>
          auditIamDecision({
            principal,
            action,
            resource: batch[index]!,
            result,
            evaluationLatencyMs: 0,
            authorizationMode: mode,
          }),
        );
        if (mode === "enforce" && results.some((result) => result.decision !== "Allow")) throw iamAccountDenied();
      }
    };
    const recheck = async () => {
      const current = await this.actors.principal(actorUserId);
      if (current.accountOwnerId !== principal.accountOwnerId || current.subjectType !== principal.subjectType)
        throw iamAccountDenied();
      await this.identities.recheck(principal, permission, snapshot);
      if (fingerprint !== undefined && fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== fingerprint)
        throw iamAccountDenied();
      await check([...registered]);
    };
    await recheck();
    return {
      principal,
      snapshot,
      recheck,
      persist: true,
      authorize: async (resources) => {
        await check(resources);
        resources.forEach((resource) => registered.add(resource));
      },
      authorizeBoundProfileEdit: async () => {
        throw iamAccountDenied();
      },
      authorizeAccountUnbind: async () => {
        throw iamAccountDenied();
      },
      visible: (channel) => this.channels.canAccessChannelMetadata(channel, actorUserId),
    };
  }

  private assertRequest(principal: IamPrincipal, request: TypedRequest) {
    const authenticated = getIamPrincipal(request);
    if (
      !authenticated ||
      authenticated.subjectUserId !== principal.subjectUserId ||
      authenticated.accountOwnerId !== principal.accountOwnerId ||
      authenticated.subjectType !== principal.subjectType ||
      authenticated.roleSessionId ||
      request.oauthAccessToken ||
      request.user?.impersonatorId ||
      request.accessKey
    )
      throw iamAccountDenied();
  }
}
