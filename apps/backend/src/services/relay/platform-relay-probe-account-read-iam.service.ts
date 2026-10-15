import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import {
  PlatformRelayProbeAccountReadRepository,
  type PlatformRelayProbeAccountReadStore,
  type RelayProbeAccountPublicRecord,
} from "@/store/relay/platform-relay-probe-account-read.repository";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:ListProbeAccounts",
  permission = Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE;
export class PlatformRelayProbeAccountReadIamService {
  private static instance: PlatformRelayProbeAccountReadIamService;
  static getInstance() {
    return (this.instance ??= new PlatformRelayProbeAccountReadIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformRelayProbeAccountReadStore = PlatformRelayProbeAccountReadRepository.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  async list<T>(
    request: TypedRequest | undefined,
    map: (account: RelayProbeAccountPublicRecord) => Promise<T>,
    legacy: () => Promise<T[]>,
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
    const native = async () => {
      const snapshot = await this.snapshots.snapshot(principal, permission),
        policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const recheck = async () => {
        await this.snapshots.recheck(principal, permission, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
      };
      await recheck();
      const result = await this.repository.list(
        principal,
        (resources) => platformCollectionDecisions(this.iam, { principal, action, request, resources }),
        recheck,
        map,
      );
      await recheck();
      return result;
    };
    if (mode === "enforce") return native();
    try {
      await native();
    } catch {
      getLogger("RelayProbeAccountReadIam", LogCategory.SECURITY).warn("Probe account shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
}
