import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { RelayChannelService } from "./relay-channel.service";
import type { RelayProbeMutationContext } from "@/store/relay/platform-relay-probe-mutation";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const permission = Permission.RELAY_CHANNEL_PROBE_EXECUTE;
export class RelayProbeMutationIamService {
  private static instance: RelayProbeMutationIamService;
  static getInstance() {
    return (this.instance ??= new RelayProbeMutationIamService());
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
  async mutate<T>(
    action: "quyan:relay:ClearProbeHistory" | "quyan:relay:DeleteProbeProfile",
    actorUserId: string,
    request: TypedRequest | undefined,
    mutate: (context: RelayProbeMutationContext) => Promise<T>,
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
    const native = async (persist: boolean) => {
      const snapshot = await this.snapshots.snapshot(principal, permission),
        fingerprint = fingerprintIamPolicies(await this.iam.loadPolicies(principal)),
        resources = new Map<string, Set<string>>();
      const authorizeAction = async (checkedAction: string, batch: readonly string[]) => {
        if (batch.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) throw iamAccountDenied();
        if (
          (
            await platformCollectionDecisions(this.iam, { principal, action: checkedAction, request, resources: batch })
          ).some((value) => value !== "Allow")
        )
          throw iamAccountDenied();
        const registered = resources.get(checkedAction) ?? new Set<string>();
        batch.forEach((resource) => registered.add(resource));
        resources.set(checkedAction, registered);
      };
      const authorize = (batch: readonly string[]) => authorizeAction(action, batch);
      const recheck = async () => {
        await this.snapshots.recheck(principal, permission, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== fingerprint) throw iamAccountDenied();
        const limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
        for (const [checkedAction, checkedResources] of resources) {
          const all = [...checkedResources];
          for (let offset = 0; offset < all.length; offset += limit)
            await authorizeAction(checkedAction, all.slice(offset, offset + limit));
        }
      };
      await recheck();
      return mutate({
        principal,
        snapshot,
        authorize,
        authorizeAccountUnbind: async (batch) => {
          if (action !== "quyan:relay:DeleteProbeProfile") throw iamAccountDenied();
          await authorizeAction("quyan:relay:UnbindProbeAccount", batch);
        },
        recheck,
        persist,
        visible: (channel) => this.channels.canAccessChannelMetadata(channel, actorUserId, principal.roleSessionId),
      });
    };
    if (mode === "enforce") return native(true);
    try {
      await native(false);
    } catch {
      getLogger("RelayProbeMutationIam", LogCategory.SECURITY).warn("Probe mutation shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
}
