import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import type { ProbeChannelVisibilityRecord } from "@/store/relay/relay-probe-latest-run-read.repository";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { RelayChannelService } from "./relay-channel.service";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
export interface RelayProbeReadContext {
  principal: IamPrincipal;
  decide: (resources: readonly string[]) => Promise<readonly string[]>;
  recheck: () => Promise<void>;
  visible: (channel: ProbeChannelVisibilityRecord) => Promise<boolean>;
}
const permission = Permission.RELAY_CHANNEL_PROBE_READ;
export class RelayProbeReadIamService {
  private static instance: RelayProbeReadIamService;
  static getInstance() {
    return (this.instance ??= new RelayProbeReadIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
    private readonly channels: Pick<
      RelayChannelService,
      "canAccessChannelMetadata"
    > = RelayChannelService.getInstance(),
  ) {}
  async read<T>(
    action: "quyan:relay:ListLatestProbeRuns" | "quyan:relay:ListProbeRuns" | "quyan:relay:GetProbeProfile",
    actorUserId: string,
    request: TypedRequest | undefined,
    read: (context: RelayProbeReadContext) => Promise<T>,
    legacy: () => Promise<T>,
  ): Promise<T> {
    const mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return legacy();
    }
    const principal = getIamPrincipal(request);
    if (
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== principal.principalUserId ||
      principal.subjectUserId !== actorUserId
    )
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
    const native = async () => {
      const snapshot = await this.snapshots.snapshot(principal, permission),
        policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const recheck = async () => {
        await this.snapshots.recheck(principal, permission, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
      };
      await recheck();
      const result = await read({
        principal,
        decide: (resources) => platformCollectionDecisions(this.iam, { principal, action, request, resources }),
        recheck,
        visible: (channel) => this.channels.canAccessChannelMetadata(channel, actorUserId, principal.roleSessionId),
      });
      await recheck();
      return result;
    };
    if (mode === "enforce") return native();
    try {
      await native();
    } catch {
      getLogger("RelayProbeReadIam", LogCategory.SECURITY).warn("Probe read shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
}
