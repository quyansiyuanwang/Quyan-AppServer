import { iamLegacyPermissionsForAction } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformApiLogReadRepository } from "@/store/system/platform-api-log-read.repository";
import type { PlatformApiLogStatisticsStore } from "@/store/system/platform-api-log-read.store";
import type { ApiLogFilters } from "@/store/system/apilog.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { SystemService } from "./system.service";
import { SystemLogStatisticsAccumulator } from "./system-log-statistics";
import { PlatformApiLogCollectionIamService } from "./platform-api-log-collection-iam.service";
import { systemLogStatsQuerySchema } from "@/api/schema/system/system.schema";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type { SystemLogStatsDTO } from "@/api/dto/system/system.dto";
const action = "quyan:system:log:GetLogStatistics";
export class PlatformApiLogStatsIamService {
  private static instance: PlatformApiLogStatsIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformApiLogStatisticsStore = PlatformApiLogReadRepository.getInstance(),
    private readonly reports: Pick<SystemService, "getLogStats"> = SystemService.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformApiLogStatsIamService());
  }
  private query(filters: ApiLogFilters): ApiLogFilters {
    const { startDate, endDate, ...rest } = filters;
    if (
      [startDate, endDate].some(
        (date) => date !== undefined && (!(date instanceof Date) || !Number.isFinite(date.getTime())),
      )
    )
      throw new BadRequestError("Invalid log statistics query", undefined, { messageKey: "errors.badRequest" });
    const parsed = systemLogStatsQuerySchema.safeParse({
      ...rest,
      startDate: startDate?.toISOString(),
      endDate: endDate?.toISOString(),
    });
    if (!parsed.success || Object.keys(rest).some((key) => !Object.prototype.hasOwnProperty.call(parsed.data, key)))
      throw new BadRequestError("Invalid log statistics query", undefined, { messageKey: "errors.badRequest" });
    const { startDate: _start, endDate: _end, ...query } = parsed.data;
    return { ...query, startDate, endDate };
  }
  async statistics(filters: ApiLogFilters, request: TypedRequest): Promise<SystemLogStatsDTO> {
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
      const accumulator = new SystemLogStatisticsAccumulator(query);
      return new PlatformApiLogCollectionIamService(this.iam, this.snapshots, this.repository).read(
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
                      !PlatformApiLogCollectionIamService.valid(row) ||
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
                if (result.summary.totalRequests !== total) throw iamAccountDenied();
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
          getLogger("ApiLogStatisticsIam", LogCategory.SECURITY).warn(
            "API log statistics IAM shadow evaluation failed",
            { action, reason: "iam-evaluation-denied-or-unavailable" },
          );
        }
      }
      return this.reports.getLogStats(query);
    }
    const result = await native(true);
    if (!result) throw iamAccountDenied();
    return result;
  }
}
