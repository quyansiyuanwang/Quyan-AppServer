import type { IPBlackList } from "@prisma/client";
import type { PlatformCollectionStore, PlatformCollectionTarget } from "../system/platform-collection.store";
export interface IpDashboardFilters {
  now: Date;
}
export interface IpDashboardWhere {
  now: Date;
  start: Date;
}
export interface IpDashboardTarget extends PlatformCollectionTarget {
  source: "ban" | "event";
  recordId: string;
  ipAddress: string;
  banLevel?: number;
  banType?: string;
  expireTime?: Date;
}
export interface PlatformIpMonitoringDashboardStore
  extends PlatformCollectionStore<IpDashboardFilters, IpDashboardWhere, IpDashboardTarget> {
  hydrateBans(targets: readonly IpDashboardTarget[]): Promise<IPBlackList[]>;
}
