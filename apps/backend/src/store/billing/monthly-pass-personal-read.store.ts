import type { IamPersonalCollectionStore } from "@/iam/collection/personal-collection.service";
import type { MonthlyPassAssignmentReadRecord } from "./platform-monthly-pass-assignment-read.store";
import type { MonthlyPassUsageSummary } from "./monthly-pass.store";
export interface MonthlyPassPersonalReadView {
  record: MonthlyPassAssignmentReadRecord;
  usageSummary?: Record<string, MonthlyPassUsageSummary>;
}
export type MonthlyPassPersonalReadStore = IamPersonalCollectionStore<MonthlyPassPersonalReadView>;
