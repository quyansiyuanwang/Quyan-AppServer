import type { DeveloperQuotaOverride } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
export type DeveloperQuotaReadTarget = Pick<
  DeveloperQuotaOverride,
  "id" | "status" | "subjectType" | "subjectId" | "service" | "createTime" | "updateTime"
>;
export interface PlatformDeveloperQuotaReadStore {
  scan(principal: IamPrincipal, after?: string): Promise<DeveloperQuotaReadTarget[]>;
  recheck(principal: IamPrincipal, targets: readonly DeveloperQuotaReadTarget[]): Promise<DeveloperQuotaReadTarget[]>;
  hydrate(principal: IamPrincipal, targets: readonly DeveloperQuotaReadTarget[]): Promise<DeveloperQuotaOverride[]>;
}
