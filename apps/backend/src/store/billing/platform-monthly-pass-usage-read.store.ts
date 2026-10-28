import type { MonthlyPassUsage } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import type { PlatformCollectionStore, PlatformCollectionTarget } from "../system/platform-collection.store";
export interface MonthlyPassUsageFilters {
  userId?: string;
  templateId?: string;
  model?: string;
  startAt?: Date;
  endAt?: Date;
}
export interface MonthlyPassUsageReadTarget extends PlatformCollectionTarget {
  userId: string;
  passId: string;
  templateId: string;
  revision: string;
}
export interface MonthlyPassUsageReadView {
  record: MonthlyPassUsage;
  templateId: string;
  templateName?: string;
}
export interface PlatformMonthlyPassUsageReadStore
  extends PlatformCollectionStore<MonthlyPassUsageFilters, MonthlyPassUsageFilters, MonthlyPassUsageReadTarget> {
  hydrate(
    principal: IamPrincipal,
    page: readonly { target: MonthlyPassUsageReadTarget; templateName: boolean }[],
  ): Promise<MonthlyPassUsageReadView[]>;
}
