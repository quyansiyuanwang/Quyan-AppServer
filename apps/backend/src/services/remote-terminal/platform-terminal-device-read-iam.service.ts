import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import {
  platformTerminalEntitlementArn,
  platformTerminalBindingArn,
} from "@/iam/resources/platform-terminal-entitlement-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import {
  PlatformTerminalDeviceReadRepository,
  validTerminalDeviceTarget,
} from "@/store/remote-terminal-product/platform-terminal-device-read.repository";
import type {
  PlatformTerminalDeviceReadStore,
  TerminalDeviceFilters,
  TerminalDeviceTarget,
  TerminalDeviceProjection,
  TerminalDeviceReadView,
} from "@/store/remote-terminal-product/platform-terminal-device-read.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PlatformMetadataCollectionIamService } from "@/services/system/platform-metadata-collection-iam.service";
import { PermissionService } from "@/services/users/permission.service";
import type { TypedRequest } from "@/types/express";
import { getLogger, LogCategory } from "@/util/logger";

const action = "quyan:remote_terminal:ListDeviceBindings";
/** Admit primary rows and every related public contribution before page-only hydration. */
export class PlatformTerminalDeviceReadIamService {
  private static instance: PlatformTerminalDeviceReadIamService;
  static getInstance() {
    return (this.instance ??= new PlatformTerminalDeviceReadIamService());
  }
  constructor(
    private readonly repository: PlatformTerminalDeviceReadStore = PlatformTerminalDeviceReadRepository.getInstance(),
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  private decisions(principal: IamPrincipal, request: TypedRequest, resources: readonly string[]) {
    return platformCollectionDecisions(this.iam, { action, principal, request, resources });
  }
  private async project(principal: IamPrincipal, request: TypedRequest, target: TerminalDeviceTarget) {
    const resources = [
      platformUserArn(target.userId),
      platformTerminalEntitlementArn(target.userId, target.entitlementId),
    ];
    const decisions = await this.decisions(principal, request, resources);
    const projection: TerminalDeviceProjection = {
      username: decisions[0] === "Allow",
      entitlementName: decisions[1] === "Allow",
    };
    return { projection, signature: JSON.stringify(resources.map((resource, index) => [resource, decisions[index]])) };
  }
  async list<T>(
    request: TypedRequest,
    pagination: { page: number; pageSize: number },
    filters: TerminalDeviceFilters,
    map: (view: TerminalDeviceReadView) => T,
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
      pagination.pageSize > 100 ||
      !Number.isSafeInteger(pagination.page * pagination.pageSize)
    )
      throw iamAccountDenied();
    const native = async () => {
      const selected: TerminalDeviceTarget[] = [],
        projections = new Map<string, TerminalDeviceProjection>();
      const result = await new PlatformMetadataCollectionIamService(
        this.iam,
        this.snapshots,
        this.repository,
        (target) => platformTerminalBindingArn(target.userId, target.id),
        async (target) => {
          const { projection, signature } = await this.project(principal, request, target);
          projections.set(target.id, projection);
          return [target.revision, target.displayOrder, signature, projection];
        },
        validTerminalDeviceTarget,
      ).read(action, principal, request, filters, {
        visit: async (targets) => {
          selected.push(...targets);
        },
        finish: async (total) => {
          selected.sort((a, b) => a.displayOrder - b.displayOrder);
          const page = selected.slice(
            (pagination.page - 1) * pagination.pageSize,
            pagination.page * pagination.pageSize,
          );
          const views = await this.repository.hydrate(
            principal,
            page.map((target) => {
              const projection = projections.get(target.id);
              if (!projection) throw iamAccountDenied();
              return { target, projection };
            }),
          );
          if (
            !Array.isArray(views) ||
            views.length !== page.length ||
            views.some(
              (view, index) =>
                !view || view.record.id !== page[index]?.id || view.record.userId !== page[index]?.userId,
            )
          )
            throw iamAccountDenied();
          return { total, records: views.map(map), ...pagination };
        },
      });
      if (!result) throw iamAccountDenied();
      return result;
    };
    if (mode === "enforce") return native();
    if (
      !(
        await this.permissions.checkUserPermissions(
          principal.subjectUserId,
          [Permission.REMOTE_TERMINAL_DEVICE_MANAGE_READ],
          { assumedRoleSessionId: principal.roleSessionId },
        )
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "shadow")
      try {
        await native();
      } catch {
        getLogger("PlatformTerminalDeviceIam", LogCategory.SECURITY).warn("Device shadow evaluation failed", {
          action,
          reason: "iam-evaluation-denied-or-unavailable",
        });
      }
    return { ...(await legacy()), ...pagination };
  }
}
