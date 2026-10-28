import { Permission, CustomCode } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { contentSafetySystemConfigArn } from "@/iam/resources/content-safety-system-resources";
import { PlatformResourceReadIamService } from "./platform-resource-read-iam.service";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import { ContentSafetySystemConfigMutationRepository } from "@/store/system/content-safety-system-config-mutation.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import type {
  ContentSafetySystemConfigMutationStore,
  ContentSafetySystemConfigMutationGuard,
} from "@/store/system/content-safety-system-config-mutation.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { ForbiddenError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const action = "quyan:content_safety:UpdateSystemConfig";
export class ContentSafetySystemConfigMutationIamService {
  private static instance: ContentSafetySystemConfigMutationIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: ContentSafetySystemConfigMutationStore = ContentSafetySystemConfigMutationRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new ContentSafetySystemConfigMutationIamService());
  }
  private async prepare(request: TypedRequest) {
    const identity = getIamPrincipal(request);
    if (!identity) throw iamAccountDenied();
    const principal = { ...identity };
    return new PlatformResourceReadIamService(this.iam, this.snapshots).read(
      action,
      principal,
      request,
      contentSafetySystemConfigArn(),
      async (reader) => {
        const source = await this.repository.configuration();
        if (!/^[a-f0-9]{64}$/.test(source.revision)) throw iamAccountDenied();
        const snapshot = await this.snapshots.snapshot(principal, Permission.SYSTEM_CONFIG),
          authorizationRevision = await this.repository.authorizationRevision(principal);
        const guard: ContentSafetySystemConfigMutationGuard = {
          group: snapshot.group,
          sourceRevision: source.revision,
          authorizationRevision,
          users: {
            principal,
            targetUserId: principal.subjectUserId,
            users: snapshot.users,
            recheck: async () => {
              await reader.recheck();
              await this.snapshots.recheck(principal, Permission.SYSTEM_CONFIG, snapshot);
              if ((await this.repository.authorizationRevision(principal)) !== authorizationRevision)
                throw iamAccountDenied();
            },
          },
        };
        return guard;
      },
    );
  }
  async update<T>(
    request: TypedRequest,
    actorUserId: string,
    updates: () => Record<string, string>,
    legacy: () => Promise<T>,
    view: (values: Record<string, string>) => Promise<T>,
  ) {
    const principal = request && getIamPrincipal(request),
      mode = env.security.iamAuthorizationMode;
    if (
      !principal ||
      principal.subjectUserId !== actorUserId ||
      principal.subjectUserId !== principal.principalUserId ||
      request.oauthAccessToken ||
      !["legacy", "shadow", "enforce"].includes(mode)
    )
      throw iamAccountDenied();
    if (request.user?.impersonatorId && request.user.impersonationMode === "view")
      throw new ForbiddenError(
        "Read-only impersonation cannot update system configuration",
        CustomCode.IMPERSONATION_READONLY_VIOLATION,
        { messageKey: "errors.impersonationReadonlyViolation" },
      );
    if (mode === "enforce") {
      const guard = await this.prepare(request);
      const result = await this.repository.update(updates(), guard);
      return view(result.values);
    }
    if (
      !(
        await this.permissions.checkUserPermissions(principal.subjectUserId, [Permission.SYSTEM_CONFIG], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "shadow") {
      try {
        const guard = await this.prepare(request);
        updates();
        await guard.users.recheck();
      } catch {
        getLogger("ContentSafetyIamBridge", LogCategory.SECURITY).warn("IAM config mutation shadow denied", {
          action,
          reason: "iam-mutation-unavailable",
        });
      }
    }
    return legacy();
  }
}
