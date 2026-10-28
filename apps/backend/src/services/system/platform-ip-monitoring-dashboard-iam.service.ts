import { iamLegacyPermissionsForAction } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { platformIpAddressArn, platformIpAddressIdentifier } from "@/iam/resources/platform-ip-address-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformIpMonitoringDashboardRepository } from "@/store/security/platform-ip-monitoring-dashboard.repository";
import type {
  IpDashboardTarget,
  PlatformIpMonitoringDashboardStore,
} from "@/store/security/platform-ip-monitoring-dashboard.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { IPBlackListService } from "./ipblacklist.service";
import { PlatformMetadataCollectionIamService } from "./platform-metadata-collection-iam.service";
import { IP_MONITORING_DASHBOARD_LIMITS as limits } from "@/constant/ip-monitoring-dashboard";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type { MonitoringDashboardResponse } from "@/api/dto/system/ipblacklist.dto";
const action = "quyan:system:ip_blacklist:GetMonitoringDashboard";
export class PlatformIpMonitoringDashboardIamService {
  private static instance: PlatformIpMonitoringDashboardIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformIpMonitoringDashboardStore = PlatformIpMonitoringDashboardRepository.getInstance(),
    private readonly reports: Pick<IPBlackListService, "getMonitoringDashboard"> = IPBlackListService.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformIpMonitoringDashboardIamService());
  }
  async read(request: TypedRequest): Promise<MonitoringDashboardResponse> {
    const identity = getIamPrincipal(request),
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
      const now = new Date(),
        last24 = now.getTime() - 24 * 60 * 60 * 1000;
      const recent: IpDashboardTarget[] = [],
        activeIps = new Set<string>();
      const byLevel = { level1: 0, level2: 0, level3: 0 },
        byType = { auto: 0, manual: 0 };
      const sampled: IpDashboardTarget[] = [];
      let activeTotal = 0,
        last24Hours = 0,
        last7Days = 0;
      return new PlatformMetadataCollectionIamService(
        this.iam,
        this.snapshots,
        this.repository,
        (target) => {
          if (
            !platformIpAddressIdentifier(target.ipAddress) ||
            !isPlatformLogResourceId(target.recordId) ||
            !["ban", "event"].includes(target.source) ||
            target.id !== target.source + "_" + target.recordId
          )
            throw iamAccountDenied();
          if (
            target.source === "ban" &&
            (!Number.isInteger(target.banLevel) ||
              typeof target.banType !== "string" ||
              !(target.expireTime instanceof Date) ||
              !Number.isFinite(target.expireTime.getTime()) ||
              target.expireTime <= now)
          )
            throw iamAccountDenied();
          return platformIpAddressArn(target.ipAddress);
        },
        (target) => [target.source, target.banLevel, target.banType, target.expireTime?.toISOString()],
      ).read(
        action,
        principal,
        request,
        { now },
        hydrate
          ? {
              visit: async (targets) => {
                for (const target of targets) {
                  if (target.source === "ban") {
                    activeTotal++;
                    activeIps.add(target.ipAddress);
                    if (recent.length < limits.recentBans) recent.push(target);
                    if (target.banLevel === 1) byLevel.level1++;
                    else if (target.banLevel === 2) byLevel.level2++;
                    else if (target.banLevel === 3) byLevel.level3++;
                    if (target.banType === "auto") byType.auto++;
                    else byType.manual++;
                  } else {
                    last7Days++;
                    if (target.createTime.getTime() >= last24) last24Hours++;
                    if (sampled.length < limits.sampledEvents) sampled.push(target);
                  }
                }
              },
              finish: async () => {
                const rows = recent.length ? await this.repository.hydrateBans(recent) : [];
                if (
                  rows.length !== recent.length ||
                  new Set(rows.map((row) => row.id)).size !== rows.length ||
                  rows.some(
                    (row) =>
                      !PlatformMetadataCollectionIamService.valid(row) ||
                      !recent.some(
                        (target) =>
                          target.recordId === row.id &&
                          target.ipAddress === row.ipAddress &&
                          target.createTime.getTime() === row.createTime.getTime() &&
                          target.updateTime.getTime() === row.updateTime.getTime() &&
                          target.banLevel === row.banLevel &&
                          target.banType === row.banType &&
                          row.ExpireTime?.getTime() === target.expireTime?.getTime(),
                      ),
                  )
                )
                  throw iamAccountDenied();
                const mapped = new Map(rows.map((row) => [row.id, row]));
                const timeline = Array.from({ length: 7 }, (_, index) => {
                  const date = new Date(now.getTime() - (6 - index) * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!;
                  return {
                    date,
                    count: sampled.filter((row) => row.createTime.toISOString().split("T")[0] === date).length,
                  };
                });
                const counts = new Map<string, { count: number; last: Date }>();
                for (const target of sampled) {
                  const current = counts.get(target.ipAddress);
                  if (current) {
                    current.count++;
                    if (target.createTime > current.last) current.last = target.createTime;
                  } else counts.set(target.ipAddress, { count: 1, last: target.createTime });
                }
                const topBannedIPs = [...counts]
                  .map(([ip, value]) => ({
                    ipAddress: ip,
                    banCount: value.count,
                    lastBanTime: value.last.toISOString(),
                    currentStatus: activeIps.has(ip) ? ("banned" as const) : ("unbanned" as const),
                  }))
                  .sort((a, b) => b.banCount - a.banCount)
                  .slice(0, limits.topIPs);
                return {
                  activeBans: {
                    total: activeTotal,
                    byLevel,
                    byType,
                    recentBans: recent.map((target) => {
                      const row = mapped.get(target.recordId)!;
                      return {
                        id: row.id,
                        ipAddress: row.ipAddress,
                        expireTime: row.ExpireTime?.toISOString() || "",
                        banLevel: row.banLevel,
                        banReason: row.reason || "",
                        bannedBy: row.bannedBy,
                        errorCount: 0,
                        metadata: {},
                        status: row.status,
                        createTime: row.createTime.toISOString(),
                        updateTime: row.updateTime.toISOString(),
                      };
                    }),
                  },
                  recentActivity: { last24Hours, last7Days, timeline },
                  topBannedIPs,
                };
              },
            }
          : undefined,
      );
    };
    if (env.security.iamAuthorizationMode !== "enforce") {
      if (
        !(
          await this.permissions.checkUserPermissions(principal.subjectUserId, required, {
            assumedRoleSessionId: principal.roleSessionId,
          })
        ).hasPermission
      )
        throw iamAccountDenied();
      if (env.security.iamAuthorizationMode === "shadow")
        try {
          await native(false);
        } catch {
          getLogger("IpMonitoringDashboardIam", LogCategory.SECURITY).warn(
            "IP dashboard IAM shadow evaluation failed",
            { action, reason: "iam-evaluation-denied-or-unavailable" },
          );
        }
      return this.reports.getMonitoringDashboard();
    }
    const result = await native(true);
    if (!result) throw iamAccountDenied();
    return result;
  }
}
