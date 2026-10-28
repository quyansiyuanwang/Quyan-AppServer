import { platformBusinessLogArn } from "@/iam/resources/platform-business-log-resources";
import { iamLegacyPermissionsForAction } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformBusinessLogReadRepository } from "@/store/system/platform-business-log-read.repository";
import type { PlatformBusinessLogStatisticsStore } from "@/store/system/platform-business-log-read.repository";
import type { BusinessLogFilters } from "@/store/system/platform-business-log-read.repository";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import BusinessLogService from "./businesslog.service";
import { BusinessLogStatisticsAccumulator } from "./business-log-statistics";
import { PlatformMetadataCollectionIamService } from "./platform-metadata-collection-iam.service";
import { businessLogStatsQuerySchema } from "@/api/schema/system/businesslog.schema";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type { BusinessLogStatsResponse } from "@/api/dto/system/businesslog.dto";
const action = "quyan:system:business_log:GetLogStatistics";
export class PlatformBusinessLogStatsIamService {
  private static instance: PlatformBusinessLogStatsIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformBusinessLogStatisticsStore = PlatformBusinessLogReadRepository.getInstance(),
    private readonly reports: Pick<BusinessLogService, "getStats"> = BusinessLogService.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformBusinessLogStatsIamService());
  }
  private query(filters: BusinessLogFilters): BusinessLogFilters {
    const { startDate, endDate, ...rest } = filters;
    if (
      [startDate, endDate].some(
        (date) => date !== undefined && (!(date instanceof Date) || !Number.isFinite(date.getTime())),
      )
    )
      throw new BadRequestError("Invalid log statistics query", undefined, { messageKey: "errors.badRequest" });
    const parsed = businessLogStatsQuerySchema.safeParse({
      ...rest,
      startDate: startDate?.toISOString(),
      endDate: endDate?.toISOString(),
    });
    if (!parsed.success || Object.keys(rest).some((key) => !Object.prototype.hasOwnProperty.call(parsed.data, key)))
      throw new BadRequestError("Invalid log statistics query", undefined, { messageKey: "errors.badRequest" });
    const { startDate: _start, endDate: _end, ...query } = parsed.data;
    return { ...query, startDate, endDate };
  }
  async statistics(filters: BusinessLogFilters, request: TypedRequest): Promise<BusinessLogStatsResponse> {
    const query = this.query(filters),
      identity = getIamPrincipal(request),
      required = iamLegacyPermissionsForAction(action);
    if (
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !required.length ||
      !["legacy", "shadow", "enforce"].includes(env.security.iamAuthorizationMode)
    )
      throw iamAccountDenied();
    const principal = { ...identity };
    const native = async (hydrate: boolean) => {
      const accumulator = new BusinessLogStatisticsAccumulator(query);
      return new PlatformMetadataCollectionIamService(this.iam, this.snapshots, this.repository, (target) =>
        platformBusinessLogArn(target.id),
      ).read(
        action,
        principal,
        request,
        query,
        hydrate
          ? {
              visit: async (targets) => {
                if (!targets.length) return;
                const rows = await this.repository.hydrateStats(targets);
                if (
                  rows.length !== targets.length ||
                  new Set(rows.map((row) => row.id)).size !== rows.length ||
                  rows.some(
                    (row) =>
                      !PlatformMetadataCollectionIamService.valid(row) ||
                      !targets.some(
                        (target) =>
                          target.id === row.id &&
                          target.createTime.getTime() === row.createTime.getTime() &&
                          target.updateTime.getTime() === row.updateTime.getTime(),
                      ),
                  )
                )
                  throw iamAccountDenied();
                for (const row of rows) accumulator.add(row);
              },
              finish: async (total) => {
                const result = accumulator.result();
                if (result.summary.totalLogs !== total) throw iamAccountDenied();
                return result;
              },
            }
          : undefined,
      );
    };
    if (env.security.iamAuthorizationMode !== "enforce") {
      const result = await this.permissions.checkUserPermissions(principal.subjectUserId, required, {
        assumedRoleSessionId: principal.roleSessionId,
      });
      if (
        !result.checkedPermissions.some(
          (permission) => required.includes(permission) && !result.missingPermissions?.includes(permission),
        )
      )
        throw iamAccountDenied();
      if (env.security.iamAuthorizationMode === "shadow") {
        try {
          await native(false);
        } catch {
          getLogger("BusinessLogStatisticsIam", LogCategory.SECURITY).warn(
            "Business log statistics IAM shadow evaluation failed",
            { action, reason: "iam-evaluation-denied-or-unavailable" },
          );
        }
      }
      return this.reports.getStats(query);
    }
    const result = await native(true);
    if (!result) throw iamAccountDenied();
    return result;
  }
}
