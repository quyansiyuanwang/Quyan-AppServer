import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { platformIpAddressIdentifier } from "@/iam/resources/platform-ip-address-resources";
import { OperationType } from "@/constant/operation-type";
import { iamAccountDenied } from "../users/iam-account-principal";
import type { PlatformCollectionCursor } from "../system/platform-collection.store";
import type {
  IpDashboardFilters,
  IpDashboardWhere,
  IpDashboardTarget,
  PlatformIpMonitoringDashboardStore,
} from "./platform-ip-monitoring-dashboard.store";
const size = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
/** A merged cursor gives both sources one ordered, independently verifiable contribution snapshot. */
export class PlatformIpMonitoringDashboardRepository implements PlatformIpMonitoringDashboardStore {
  private static instance: PlatformIpMonitoringDashboardRepository;
  static getInstance() {
    return (this.instance ??= new PlatformIpMonitoringDashboardRepository());
  }
  async where(filters: IpDashboardFilters) {
    if (!(filters.now instanceof Date) || !Number.isFinite(filters.now.getTime())) throw iamAccountDenied();
    return { now: new Date(filters.now), start: new Date(filters.now.getTime() - 7 * 24 * 60 * 60 * 1000) };
  }
  private position(source: "ban" | "event", cursor: PlatformCollectionCursor, inclusive: boolean) {
    if (
      !isPlatformLogResourceId(cursor.id) ||
      !/^(ban|event)_/.test(cursor.id) ||
      !isPlatformLogResourceId(cursor.id.replace(/^(ban|event)_/, "")) ||
      !(cursor.createTime instanceof Date) ||
      !Number.isFinite(cursor.createTime.getTime())
    )
      throw iamAccountDenied();
    const prefix = source + "_",
      other = cursor.id.startsWith(prefix),
      sameTime = other
        ? { createTime: cursor.createTime, id: { [inclusive ? "lte" : "lt"]: cursor.id.slice(prefix.length) } }
        : prefix < cursor.id
          ? { createTime: cursor.createTime }
          : undefined;
    return { OR: [{ createTime: { lt: cursor.createTime } }, ...(sameTime ? [sameTime] : [])] };
  }
  async scan(
    where: IpDashboardWhere,
    after?: PlatformCollectionCursor,
    boundary?: PlatformCollectionCursor,
  ): Promise<IpDashboardTarget[]> {
    const positions = (source: "ban" | "event") => [
      ...(after ? [this.position(source, after, false)] : []),
      ...(boundary ? [this.position(source, boundary, true)] : []),
    ];
    const [bans, events] = await Promise.all([
      prisma.iPBlackList.findMany({
        where: {
          AND: [{ status: 1, createTime: { lte: where.now }, ExpireTime: { gt: where.now } }, ...positions("ban")],
        },
        orderBy: [{ createTime: "desc" }, { id: "desc" }],
        take: size,
        select: {
          id: true,
          status: true,
          createTime: true,
          updateTime: true,
          ipAddress: true,
          banLevel: true,
          banType: true,
          ExpireTime: true,
        },
      }),
      prisma.businessLog.findMany({
        where: {
          AND: [
            { status: 1, operationType: OperationType.IP_BAN, createTime: { gte: where.start, lte: where.now } },
            ...positions("event"),
          ],
        },
        orderBy: [{ createTime: "desc" }, { id: "desc" }],
        take: size,
        select: { id: true, status: true, createTime: true, updateTime: true, targetResourceId: true },
      }),
    ]);
    const rows: IpDashboardTarget[] = [
      ...bans.map((row) => ({
        id: "ban_" + row.id,
        recordId: row.id,
        source: "ban" as const,
        status: row.status,
        createTime: row.createTime,
        updateTime: row.updateTime,
        ipAddress: row.ipAddress,
        banLevel: row.banLevel,
        banType: row.banType,
        expireTime: row.ExpireTime!,
      })),
      ...events.map((row) => ({
        id: "event_" + row.id,
        recordId: row.id,
        source: "event" as const,
        status: row.status,
        createTime: row.createTime,
        updateTime: row.updateTime,
        ipAddress: row.targetResourceId ?? "",
      })),
    ];
    return rows
      .sort((a, b) => b.createTime.getTime() - a.createTime.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, size);
  }
  async hydrateBans(targets: readonly IpDashboardTarget[]) {
    if (!targets.length) return [];
    if (
      targets.length > size ||
      new Set(targets.map((row) => row.recordId)).size !== targets.length ||
      targets.some(
        (row) =>
          row.source !== "ban" ||
          row.id !== "ban_" + row.recordId ||
          !isPlatformLogResourceId(row.recordId) ||
          !platformIpAddressIdentifier(row.ipAddress) ||
          row.status !== 1 ||
          !(row.createTime instanceof Date) ||
          !Number.isFinite(row.createTime.getTime()) ||
          !(row.updateTime instanceof Date) ||
          !Number.isFinite(row.updateTime.getTime()),
      )
    )
      throw iamAccountDenied();
    return prisma.iPBlackList.findMany({
      where: {
        status: 1,
        OR: targets.map((row) => ({
          id: row.recordId,
          ipAddress: row.ipAddress,
          createTime: row.createTime,
          updateTime: row.updateTime,
        })),
      },
    });
  }
}
