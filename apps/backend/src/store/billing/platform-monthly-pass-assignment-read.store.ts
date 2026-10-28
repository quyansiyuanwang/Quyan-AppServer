import type { MonthlyPassTemplate, UserMonthlyPass, UserMonthlyPassQuotaWindow } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import type { PlatformCollectionStore, PlatformCollectionTarget } from "../system/platform-collection.store";
export interface MonthlyPassAssignmentFilters {
  userId?: string;
  templateId?: string;
  status?: number;
}
export interface MonthlyPassAssignmentReadTarget extends PlatformCollectionTarget {
  userId: string;
  templateId: string;
  revision: string;
  displayOrder: number;
}
export interface MonthlyPassAssignmentProjection {
  username: boolean;
  template: boolean;
  quotaUsage: boolean;
}
export type MonthlyPassAssignmentReadRecord = UserMonthlyPass & {
  quotaWindows: UserMonthlyPassQuotaWindow[];
  template: Pick<MonthlyPassTemplate, "name" | "description" | "allowedModels" | "allowedChannels">;
  user: { username: string };
};
export interface MonthlyPassAssignmentReadView {
  record: MonthlyPassAssignmentReadRecord;
  quotaUsage: boolean;
}
export interface MonthlyPassAssignmentUsageReference {
  id: string;
  userId: string;
  userMonthlyPassId: string;
  status: number;
}
export interface PlatformMonthlyPassAssignmentReadStore
  extends PlatformCollectionStore<
    MonthlyPassAssignmentFilters,
    MonthlyPassAssignmentFilters,
    MonthlyPassAssignmentReadTarget
  > {
  scanUsages(target: MonthlyPassAssignmentReadTarget, after?: string): Promise<MonthlyPassAssignmentUsageReference[]>;
  hydrate(
    principal: IamPrincipal,
    page: readonly { target: MonthlyPassAssignmentReadTarget; projection: MonthlyPassAssignmentProjection }[],
  ): Promise<MonthlyPassAssignmentReadView[]>;
}
