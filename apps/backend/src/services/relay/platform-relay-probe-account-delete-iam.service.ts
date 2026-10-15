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
  PlatformRelayProbeAccountDeleteRepository,
  type PlatformRelayProbeAccountDeleteStore,
} from "@/store/relay/platform-relay-probe-account-delete.repository";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:DeleteProbeAccount",
  permission = Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE;
export class PlatformRelayProbeAccountDeleteIamService {
  private static instance: PlatformRelayProbeAccountDeleteIamService;
  static getInstance() {
    return (this.instance ??= new PlatformRelayProbeAccountDeleteIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformRelayProbeAccountDeleteStore = PlatformRelayProbeAccountDeleteRepository.getInstance(),
    private readonly identities: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  async remove(
    id: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<void>,
    invalidate: () => Promise<void>,
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
      await this.repository.remove(id, principal, snapshot, recheck, persist);
    };
    if (mode === "enforce") {
      await native(true);
      await invalidate();
      return;
    }
    try {
      await native(false);
    } catch {
      getLogger("RelayProbeAccountDeleteIam", LogCategory.SECURITY).warn(
        "Probe account deletion shadow evaluation failed",
        { action, reason: "iam-evaluation-denied-or-unavailable" },
      );
    }
    return legacy();
  }
}
