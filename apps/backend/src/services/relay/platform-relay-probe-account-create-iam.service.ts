import { createId } from "@paralleldrive/cuid2";
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
import {
  platformRelayProbeAccountArn,
  platformRelayProbeAccountControlArn,
} from "@/iam/resources/platform-relay-probe-resources";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import {
  PlatformRelayProbeAccountCreateRepository,
  type PlatformRelayProbeAccountCreateStore,
} from "@/store/relay/platform-relay-probe-account-create.repository";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:CreateProbeAccount",
  permission = Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE;
export class PlatformRelayProbeAccountCreateIamService {
  private static instance: PlatformRelayProbeAccountCreateIamService;
  static getInstance() {
    return (this.instance ??= new PlatformRelayProbeAccountCreateIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformRelayProbeAccountCreateStore = PlatformRelayProbeAccountCreateRepository.getInstance(),
    private readonly identities: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
    private readonly allocateId: () => string = createId,
  ) {}
  async create(
    input: SaveRelayChannelProbeAccountRequest,
    encrypt: EncryptProbeAccountConfiguration,
    request: TypedRequest | undefined,
    legacy: (reservedId?: string) => Promise<RelayChannelProbeAccountDto>,
  ) {
    const parsed = saveRelayChannelProbeAccountBodySchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestError("Invalid probe account configuration", undefined, { messageKey: "errors.badRequest" });
    if (!parsed.data.credentials)
      throw new BadRequestError("Probe account credentials required", undefined, {
        messageKey: "relayChannelProbe.accountCredentialsRequired",
      });
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
    const id = this.allocateId();
    let resource: string;
    try {
      resource = platformRelayProbeAccountArn(id);
    } catch {
      throw iamAccountDenied();
    }
    const resources = [platformRelayProbeAccountControlArn(), resource];
    const native = async (persist: boolean) => {
      const snapshot = await this.identities.snapshot(principal, permission),
        policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const recheck = async () => {
        await this.identities.recheck(principal, permission, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
        const decisions = await platformCollectionDecisions(this.iam, {
          principal,
          action,
          request,
          resources,
        });
        if (decisions.some((decision) => decision !== "Allow")) throw iamAccountDenied();
      };
      await recheck();
      return this.repository.create(id, parsed.data, principal, snapshot, recheck, encrypt, persist);
    };
    if (mode === "enforce") {
      const account = await native(true);
      if (!account) throw iamAccountDenied();
      return projectRelayProbeAccount(account, false);
    }
    try {
      await native(false);
    } catch {
      getLogger("RelayProbeAccountCreateIam", LogCategory.SECURITY).warn(
        "Probe account creation shadow evaluation failed",
        { action, reason: "iam-evaluation-denied-or-unavailable" },
      );
    }
    return legacy(id);
  }
}
