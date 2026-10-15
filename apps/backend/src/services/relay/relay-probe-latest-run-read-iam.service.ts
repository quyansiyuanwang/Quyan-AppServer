import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { BadRequestError } from "@/util/errors";
import { relayChannelProbeLatestRunsBodySchema } from "@/api/schema/relay/relay-channel-probe.schema";
import type { RelayChannelProbeLatestRunRequest } from "@/api/dto/relay/relay-channel-probe.dto";
import type { RelayProbeRunPublicRecord } from "@/store/relay/relay-probe-run-public-select";
import { RelayChannelService } from "./relay-channel.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import {
  RelayProbeLatestRunReadRepository,
  type RelayProbeLatestRunReadStore,
} from "@/store/relay/relay-probe-latest-run-read.repository";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import type { TypedRequest } from "@/types/express";
import { RelayProbeReadIamService } from "./relay-probe-read-iam.service";
export class RelayProbeLatestRunReadIamService {
  private static instance: RelayProbeLatestRunReadIamService;
  static getInstance() {
    return (this.instance ??= new RelayProbeLatestRunReadIamService());
  }
  private readonly guard: RelayProbeReadIamService;
  constructor(
    iam: Pick<IamAuthorizationService, "loadPolicies" | "authorizeMany"> = IamAuthorizationService.getInstance(),
    private readonly repository: RelayProbeLatestRunReadStore = RelayProbeLatestRunReadRepository.getInstance(),
    snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
    channels: Pick<RelayChannelService, "canAccessChannelMetadata"> = RelayChannelService.getInstance(),
  ) {
    this.guard = new RelayProbeReadIamService(iam, snapshots, permissions, channels);
  }
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
    return this.guard.read(
      "quyan:relay:ListLatestProbeRuns",
      actorUserId,
      request,
      async ({ principal, decide, recheck, visible }) => {
        try {
          for (const target of parsed.data.targets) {
            platformRelayChannelArn(target.channelId);
            if (target.memberChannelId) platformRelayChannelArn(target.memberChannelId);
          }
        } catch {
          throw iamAccountDenied();
        }
        return this.repository.latest(principal, parsed.data.targets, decide, recheck, visible, map);
      },
      legacy,
    );
  }
}
