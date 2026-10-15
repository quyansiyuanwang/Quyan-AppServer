import { RelayChannelProbeLockService } from "./relay-channel-probe-lock.service";
import { RELAY_PROBE_ACCOUNT_POLICY } from "./relay-probe-account-policy";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { platformRelayProbeAccountArn } from "@/iam/resources/platform-relay-probe-resources";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import {
  PlatformRelayProbeAccountSessionRepository,
  type PlatformRelayProbeAccountSessionStore,
} from "@/store/relay/platform-relay-probe-account-session.repository";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:RefreshProbeAccount",
  permission = Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE;
export interface ProbeAccountRefreshGuard {
  recheck: () => Promise<void>;
  recordAttempt: () => Promise<void>;
  publish: (commit: () => Promise<void>) => Promise<void>;
}
export class PlatformRelayProbeAccountRefreshIamService {
  private static instance: PlatformRelayProbeAccountRefreshIamService;
  static getInstance() {
    return (this.instance ??= new PlatformRelayProbeAccountRefreshIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformRelayProbeAccountSessionStore = PlatformRelayProbeAccountSessionRepository.getInstance(),
    private readonly identities: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
    private readonly locks: Pick<
      RelayChannelProbeLockService,
      "withWrite"
    > = RelayChannelProbeLockService.getInstance(),
  ) {}
  async execute<T>(
    id: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<T>,
    refresh: (guard: ProbeAccountRefreshGuard) => Promise<T>,
  ) {
    const mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return legacy();
    }
    const principal = getIamPrincipal(request);
    if (!principal || request.oauthAccessToken || principal.subjectUserId !== principal.principalUserId)
      throw iamAccountDenied();
    if (
      mode !== "enforce" &&
      !(
        await this.permissions.checkUserPermissions(principal.subjectUserId, [permission], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const native = async (persist: boolean) => {
      let resource: string;
      try {
        resource = platformRelayProbeAccountArn(id);
      } catch {
        throw iamAccountDenied();
      }
      const snapshot = await this.identities.snapshot(principal, permission),
        policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const recheck = async () => {
        await this.identities.recheck(principal, permission, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
        const [decision] = await platformCollectionDecisions(this.iam, {
          principal,
          action,
          request,
          resources: [resource],
        });
        if (decision !== "Allow") throw iamAccountDenied();
      };
      await recheck();
      const context = { principal, snapshot, recheck };
      if (!persist) {
        await this.repository.inspect(id, context);
        return undefined;
      }
      return this.locks.withWrite(
        `probe-account:${id}`,
        async () => {
          await recheck();
          await this.repository.inspect(id, context);
          return refresh({
            recheck,
            recordAttempt: () => this.repository.recordAttempt(id, context),
            publish: (commit) => this.repository.publish(id, context, commit),
          });
        },
        RELAY_PROBE_ACCOUNT_POLICY.refreshLockWaitMs,
      );
    };
    if (mode === "enforce") {
      return (await native(true)) as T;
    }
    try {
      await native(false);
    } catch {
      getLogger("RelayProbeAccountRefreshIam", LogCategory.SECURITY).warn(
        "Probe account refresh shadow evaluation failed",
        { action, reason: "iam-evaluation-denied-or-unavailable" },
      );
    }
    return legacy();
  }
}
