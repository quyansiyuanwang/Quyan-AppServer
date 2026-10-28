import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { platformMonthlyPassUsageArn } from "@/iam/resources/platform-monthly-pass-resources";
import { platformTemplateArn } from "@/iam/resources/platform-template-resources";
import { PlatformMetadataCollectionIamService } from "../system/platform-metadata-collection-iam.service";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import {
  PlatformMonthlyPassUsageReadRepository,
  validMonthlyPassUsageReadTarget,
} from "@/store/billing/platform-monthly-pass-usage-read.repository";
import type {
  MonthlyPassUsageFilters,
  MonthlyPassUsageReadTarget,
  MonthlyPassUsageReadView,
  PlatformMonthlyPassUsageReadStore,
} from "@/store/billing/platform-monthly-pass-usage-read.store";
import { PermissionService } from "../users/permission.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const action = "quyan:monthly_pass:ListUsages";
/** Primary record admission and independent template-name projection share one verified read snapshot. */
export class PlatformMonthlyPassUsageReadIamService {
  private static instance: PlatformMonthlyPassUsageReadIamService;
  static getInstance() {
    return (this.instance ??= new PlatformMonthlyPassUsageReadIamService());
  }
  constructor(
    private readonly repository: PlatformMonthlyPassUsageReadStore = PlatformMonthlyPassUsageReadRepository.getInstance(),
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
    filters: MonthlyPassUsageFilters,
    map: (view: MonthlyPassUsageReadView) => T,
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
      const selected: MonthlyPassUsageReadTarget[] = [],
        projections = new Map<string, boolean>();
      const result = await new PlatformMetadataCollectionIamService(
        this.iam,
        this.snapshots,
        this.repository,
        (target) => platformMonthlyPassUsageArn(target.userId, target.passId, target.id),
        async (target) => {
          const decision = (
            await platformCollectionDecisions(this.iam, {
              action,
              principal,
              request,
              resources: [platformTemplateArn("monthly-pass", target.templateId)],
            })
          )[0];
          projections.set(target.id, decision === "Allow");
          return [target.revision, decision];
        },
        validMonthlyPassUsageReadTarget,
      ).read(action, principal, request, filters, {
        visit: async (targets) => {
          selected.push(...targets);
        },
        finish: async (total) => {
          const page = selected.slice(
            (pagination.page - 1) * pagination.pageSize,
            pagination.page * pagination.pageSize,
          );
          const views = await this.repository.hydrate(
            principal,
            page.map((target) => {
              const templateName = projections.get(target.id);
              if (templateName === undefined) throw iamAccountDenied();
              return { target, templateName };
            }),
          );
          if (
            !Array.isArray(views) ||
            views.length !== page.length ||
            views.some(
              (view, index) =>
                !view ||
                view.record.id !== page[index]?.id ||
                view.record.userId !== page[index]?.userId ||
                view.record.userMonthlyPassId !== page[index]?.passId ||
                view.templateId !== page[index]?.templateId ||
                (projections.get(view.record.id) === false && view.templateName !== undefined),
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
        await this.permissions.checkUserPermissions(principal.subjectUserId, [Permission.MONTHLY_PASS_USAGE_READ], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "shadow")
      try {
        await native();
      } catch {
        getLogger("MonthlyPassUsageIam", LogCategory.SECURITY).warn("Monthly pass usage shadow evaluation failed", {
          action,
          reason: "iam-evaluation-denied-or-unavailable",
        });
      }
    return { ...(await legacy()), ...pagination };
  }
}
