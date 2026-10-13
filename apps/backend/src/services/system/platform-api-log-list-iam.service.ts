import { PlatformApiLogCollectionIamService } from "./platform-api-log-collection-iam.service";
import { iamLegacyPermissionsForAction } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformApiLogReadRepository } from "@/store/system/platform-api-log-read.repository";
import type {
  PlatformApiLogCollectionStore,
  PlatformApiLogCollectionTarget,
} from "@/store/system/platform-api-log-read.store";
import type { ApiLogFilters } from "@/store/system/apilog.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { SystemService } from "./system.service";
import { systemLogsQuerySchema } from "@/api/schema/system/system.schema";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type { SystemLogDTO } from "@/api/dto/system/system.dto";
const action = "quyan:system:log:ListLogs";
export class PlatformApiLogListIamService {
  private static instance: PlatformApiLogListIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformApiLogCollectionStore = PlatformApiLogReadRepository.getInstance(),
    private readonly reports: Pick<SystemService, "getLogs" | "mapLogListRows"> = SystemService.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformApiLogListIamService());
  }
  private query(page: number, pageSize: number, filters: ApiLogFilters) {
    const { startDate, endDate, ...rest } = filters;
    if (
      [startDate, endDate].some(
        (date) => date !== undefined && (!(date instanceof Date) || !Number.isFinite(date.getTime())),
      )
    )
      throw new BadRequestError("Invalid log query", undefined, { messageKey: "errors.badRequest" });
    const parsed = systemLogsQuerySchema.safeParse({
      ...rest,
      page,
      pageSize,
      startDate: startDate?.toISOString(),
      endDate: endDate?.toISOString(),
    });
    if (!parsed.success || Object.keys(rest).some((key) => !Object.prototype.hasOwnProperty.call(parsed.data, key)))
      throw new BadRequestError("Invalid log query", undefined, { messageKey: "errors.badRequest" });
    const { page: validatedPage, pageSize: validatedSize, startDate: _start, endDate: _end, ...query } = parsed.data;
    return { page: validatedPage!, pageSize: validatedSize!, filters: { ...query, startDate, endDate } };
  }
  async list(page: number, pageSize: number, filters: ApiLogFilters, request: TypedRequest): Promise<SystemLogDTO> {
    const query = this.query(page, pageSize, filters),
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
      const pageTargets: PlatformApiLogCollectionTarget[] = [];
      let totalSeen = 0;
      const offset = (query.page - 1) * query.pageSize;
      return new PlatformApiLogCollectionIamService(this.iam, this.snapshots, this.repository).read(
        action,
        principal,
        request,
        query.filters,
        hydrate
          ? {
              visit: async (targets) => {
                for (const target of targets) {
                  if (totalSeen >= offset && pageTargets.length < query.pageSize) pageTargets.push(target);
                  totalSeen++;
                }
              },
              finish: async (total) => {
                const rows = pageTargets.length ? await this.repository.hydrate(pageTargets) : [];
                if (
                  rows.length !== pageTargets.length ||
                  new Set(rows.map((row) => row.id)).size !== rows.length ||
                  rows.some(
                    (row) =>
                      !PlatformApiLogCollectionIamService.valid(row) ||
                      !pageTargets.some(
                        (target) =>
                          target.id === row.id &&
                          target.createTime.getTime() === row.createTime.getTime() &&
                          target.updateTime.getTime() === row.updateTime.getTime(),
                      ),
                  )
                )
                  throw iamAccountDenied();
                const byId = new Map(rows.map((row) => [row.id, row]));
                const logs = await this.reports.mapLogListRows(pageTargets.map((row) => byId.get(row.id)!));
                if (logs.length !== pageTargets.length || logs.some((row, index) => row.id !== pageTargets[index]!.id))
                  throw iamAccountDenied();
                return { logs, total };
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
          getLogger("ApiLogListIam", LogCategory.SECURITY).warn("API log list IAM shadow evaluation failed", {
            action,
            reason: "iam-evaluation-denied-or-unavailable",
          });
        }
      }
      return this.reports.getLogs(query.page, query.pageSize, query.filters);
    }
    const result = await native(true);
    if (!result) throw iamAccountDenied();
    return result;
  }
}
