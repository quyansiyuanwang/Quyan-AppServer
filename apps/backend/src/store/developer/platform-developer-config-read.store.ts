import type { DeveloperProductConfig } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
export type DeveloperConfigReadTarget = Pick<
  DeveloperProductConfig,
  "id" | "status" | "productCode" | "createTime" | "updateTime"
>;
export interface PlatformDeveloperConfigReadStore {
  scan(principal: IamPrincipal, after?: string): Promise<DeveloperConfigReadTarget[]>;
  recheck(principal: IamPrincipal, targets: readonly DeveloperConfigReadTarget[]): Promise<DeveloperConfigReadTarget[]>;
  hydrate(principal: IamPrincipal, targets: readonly DeveloperConfigReadTarget[]): Promise<DeveloperProductConfig[]>;
}
