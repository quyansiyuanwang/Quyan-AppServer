import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { BadRequestError } from "@/util/errors";
import { relayChannelProbeLatestRunsBodySchema } from "@/api/schema/relay/relay-channel-probe.schema";
import type { RelayChannelProbeLatestRunRequest } from "@/api/dto/relay/relay-channel-probe.dto";
import type { RelayProbeRunPublicRecord } from "@/store/relay/relay-probe-run-public-select";
import { RelayChannelService } from "./relay-channel.service";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import {
  RelayProbeLatestRunReadRepository,
  type RelayProbeLatestRunReadStore,
} from "@/store/relay/relay-probe-latest-run-read.repository";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:ListLatestProbeRuns",
  permission = Permission.RELAY_CHANNEL_PROBE_READ;
export class RelayProbeLatestRunReadIamService {
  private static instance: RelayProbeLatestRunReadIamService;
  static getInstance() {
    return (this.instance ??= new RelayProbeLatestRunReadIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: RelayProbeLatestRunReadStore = RelayProbeLatestRunReadRepository.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
    private readonly channels: Pick<
      RelayChannelService,
      "canAccessChannelMetadata"
    > = RelayChannelService.getInstance(),
  ) {}
  async latest<T>(
    actorUserId: string,
    input: RelayChannelProbeLatestRunRequest,
    request: TypedRequest | undefined,
    map: (run: RelayProbeRunPublicRecord) => T,
    legacy: () => Promise<{ channelId: string; memberChannelId?: string; latestRun?: T }[]>,
  ) {
    const parsed = relayChannelProbeLatestRunsBodySchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestError("Invalid probe polling targets", undefined, { messageKey: "errors.badRequest" });
    const body = parsed.data;
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
      try {
        for (const target of body.targets) {
          platformRelayChannelArn(target.channelId);
          if (target.memberChannelId) platformRelayChannelArn(target.memberChannelId);
        }
      } catch {
        throw iamAccountDenied();
      }
      const snapshot = await this.snapshots.snapshot(principal, permission),
        policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const recheck = async () => {
        await this.snapshots.recheck(principal, permission, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
      };
      await recheck();
      const result = await this.repository.latest(
        principal,
        body.targets,
        (resources) => platformCollectionDecisions(this.iam, { principal, action, request, resources }),
        recheck,
        (channel) => this.channels.canAccessChannelMetadata(channel, actorUserId, principal.roleSessionId),
        map,
      );
      await recheck();
      return result;
    };
    if (mode === "enforce") return native();
    try {
      await native();
    } catch {
      getLogger("RelayProbeLatestRunReadIam", LogCategory.SECURITY).warn(
        "Probe result polling shadow evaluation failed",
        {
          action,
          reason: "iam-evaluation-denied-or-unavailable",
        },
      );
    }
    return legacy();
  }
}
