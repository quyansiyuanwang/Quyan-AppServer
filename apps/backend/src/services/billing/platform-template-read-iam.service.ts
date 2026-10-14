import type { IamPlatformTemplateKind } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { platformTemplateArn, platformTemplateDefinition } from "@/iam/resources/platform-template-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import {
  PlatformTemplateReadRepository,
  validPlatformTemplateTarget,
} from "@/store/billing/platform-template-read.repository";
import type {
  PlatformTemplateReadStore,
  PlatformTemplateFilters,
  PlatformTemplateTarget,
  PlatformTemplateRecordMap,
} from "@/store/billing/platform-template-read.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PlatformMetadataCollectionIamService } from "@/services/system/platform-metadata-collection-iam.service";
import { PermissionService } from "@/services/users/permission.service";
import type { TypedRequest } from "@/types/express";
import { getLogger, LogCategory } from "@/util/logger";

export class PlatformTemplateReadIamService<K extends IamPlatformTemplateKind> {
  private static readonly instances = new Map<
    IamPlatformTemplateKind,
    PlatformTemplateReadIamService<IamPlatformTemplateKind>
  >();
  static getInstance<K extends IamPlatformTemplateKind>(kind: K): PlatformTemplateReadIamService<K> {
    let instance = this.instances.get(kind);
    if (!instance) {
      instance = new PlatformTemplateReadIamService(kind);
      this.instances.set(kind, instance);
    }
    return instance as PlatformTemplateReadIamService<K>;
  }
  constructor(
    private readonly kind: K,
    private readonly repository: PlatformTemplateReadStore<K> = PlatformTemplateReadRepository.getInstance(kind),
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  async list<T>(
    request: TypedRequest,
    pagination: { page: number; pageSize: number },
    filters: PlatformTemplateFilters,
    map: (record: PlatformTemplateRecordMap[K]) => T,
    legacy: () => Promise<{ total: number; records: T[] }>,
  ) {
    const principal = request && getIamPrincipal(request),
      mode = env.security.iamAuthorizationMode;
    if (
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== principal.principalUserId ||
      !["legacy", "shadow", "enforce"].includes(mode) ||
      !Number.isSafeInteger(pagination.page) ||
      pagination.page < 1 ||
      !Number.isSafeInteger(pagination.pageSize) ||
      pagination.pageSize < 1 ||
      pagination.pageSize > 100
    )
      throw iamAccountDenied();
    const definition = platformTemplateDefinition(this.kind);
    const native = async () => {
      const selected: PlatformTemplateTarget[] = [];
      const result = await new PlatformMetadataCollectionIamService(
        this.iam,
        this.snapshots,
        this.repository,
        (target) => platformTemplateArn(this.kind, target.id),
        (target) => [target.revision, target.displayOrder],
        validPlatformTemplateTarget,
      ).read(definition.action, principal, request, filters, {
        visit: async (targets) => {
          selected.push(...targets);
        },
        finish: async (total) => {
          selected.sort((a, b) => a.displayOrder - b.displayOrder);
          const page = selected.slice(
            (pagination.page - 1) * pagination.pageSize,
            pagination.page * pagination.pageSize,
          );
          const rows = await this.repository.hydrate(principal, page);
          if (
            rows.length !== page.length ||
            new Set(rows.map((row) => row.id)).size !== page.length ||
            rows.some((row, index) => row.id !== page[index]?.id)
          )
            throw iamAccountDenied();
          return { total, records: rows.map(map), ...pagination };
        },
      });
      if (!result) throw iamAccountDenied();
      return result;
    };
    if (mode === "enforce") return native();
    if (
      !(
        await this.permissions.checkUserPermissions(principal.subjectUserId, [definition.legacyPermission], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "shadow")
      try {
        await native();
      } catch {
        getLogger("PlatformTemplateIam", LogCategory.SECURITY).warn("Template shadow evaluation failed", {
          action: definition.action,
          reason: "iam-evaluation-denied-or-unavailable",
        });
      }
    return { ...(await legacy()), ...pagination };
  }
}
