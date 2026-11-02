import { Permission } from "@quyan/shared";
import type { RelayChannelProbeAccount } from "@prisma/client";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { platformRelayProbeAccountArn } from "@/iam/resources/platform-relay-probe-resources";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import { RelayProbeAccountEditorRepository } from "@/store/relay/relay-probe-account-editor.repository";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import type { TypedRequest } from "@/types/express";

const action = "quyan:relay:UpdateProbeAccount";
const permission = Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE;

/** A list grant never authorizes decryption of saved account configuration. */
export class RelayProbeAccountEditorIamService {
  private static instance: RelayProbeAccountEditorIamService;
  static getInstance() {
    return (this.instance ??= new RelayProbeAccountEditorIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: Pick<
      RelayProbeAccountEditorRepository,
      "read"
    > = RelayProbeAccountEditorRepository.getInstance(),
    private readonly identities: Pick<
      PlatformManagementReadRepository,
      "snapshot" | "recheck"
    > = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  async read<T>(
    id: string,
    request: TypedRequest | undefined,
    project: (row: RelayChannelProbeAccount) => T,
    legacy: () => Promise<T>,
  ): Promise<T> {
    const mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return legacy();
    }
    const principal = getIamPrincipal(request);
    if (!principal || request.oauthAccessToken || principal.subjectUserId !== principal.principalUserId)
      throw iamAccountDenied();
    if (mode !== "enforce") {
      const options = { assumedRoleSessionId: principal.roleSessionId };
      if (!(await this.permissions.checkUserPermissions(principal.subjectUserId, [permission], options)).hasPermission)
        throw iamAccountDenied();
      const result = await legacy();
      if (!(await this.permissions.checkUserPermissions(principal.subjectUserId, [permission], options)).hasPermission)
        throw iamAccountDenied();
      return result;
    }
    let resource: string;
    try {
      resource = platformRelayProbeAccountArn(id);
    } catch {
      throw iamAccountDenied();
    }
    const snapshot = await this.identities.snapshot(principal, permission);
    const policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
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
    return this.repository.read(id, principal, snapshot, recheck, project);
  }
}
