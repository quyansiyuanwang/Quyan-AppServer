import { RelayChannelProbeLockService } from "./relay-channel-probe-lock.service";
import { saveRelayChannelProbeAccountBodySchema } from "@/api/schema/relay/relay-channel-probe.schema";
import type {
  SaveRelayChannelProbeAccountRequest,
  RelayChannelProbeAccountDto,
} from "@/api/dto/relay/relay-channel-probe.dto";
import { projectRelayProbeAccount } from "./relay-probe-account-projection";
import { BadRequestError } from "@/util/errors";
import type { EncryptProbeAccountConfiguration } from "@/store/relay/platform-relay-probe-account-update.repository";
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
  PlatformRelayProbeAccountUpdateRepository,
  type PlatformRelayProbeAccountUpdateStore,
} from "@/store/relay/platform-relay-probe-account-update.repository";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:UpdateProbeAccount",
  permission = Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE;
export class PlatformRelayProbeAccountUpdateIamService {
  private static instance: PlatformRelayProbeAccountUpdateIamService;
  static getInstance() {
    return (this.instance ??= new PlatformRelayProbeAccountUpdateIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformRelayProbeAccountUpdateStore = PlatformRelayProbeAccountUpdateRepository.getInstance(),
    private readonly identities: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
    private readonly locks: Pick<
      RelayChannelProbeLockService,
      "withWrite"
    > = RelayChannelProbeLockService.getInstance(),
  ) {}
  async update(
    id: string,
    input: SaveRelayChannelProbeAccountRequest,
    encrypt: EncryptProbeAccountConfiguration,
    request: TypedRequest | undefined,
    legacy: () => Promise<RelayChannelProbeAccountDto>,
    invalidate: () => Promise<void>,
  ) {
    const parsed = saveRelayChannelProbeAccountBodySchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestError("Invalid probe account configuration", undefined, { messageKey: "errors.badRequest" });
    if (parsed.data.credentials && Object.prototype.hasOwnProperty.call(parsed.data.credentials, "accountToken"))
      throw new BadRequestError("Reserved probe account variable", undefined, {
        messageKey: "relayChannelProbe.accountReservedVariable",
      });
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
      if (!persist) return this.repository.update(id, parsed.data, principal, snapshot, recheck, encrypt, false);
      // Coordinate with active probes and refreshes so an old login cannot repopulate
      // the session cache after the credentials have been replaced.
      return this.locks.withWrite(`probe-account:${id}`, async () => {
        await recheck();
        const account = await this.repository.update(id, parsed.data, principal, snapshot, recheck, encrypt, true);
        if (!account) throw iamAccountDenied();
        await invalidate();
        return account;
      });
    };
    if (mode === "enforce") {
      const account = await native(true);
      if (!account) throw iamAccountDenied();
      return projectRelayProbeAccount(account, false);
    }
    try {
      await native(false);
    } catch {
      getLogger("RelayProbeAccountUpdateIam", LogCategory.SECURITY).warn(
        "Probe account update shadow evaluation failed",
        { action, reason: "iam-evaluation-denied-or-unavailable" },
      );
    }
    return legacy();
  }
}
