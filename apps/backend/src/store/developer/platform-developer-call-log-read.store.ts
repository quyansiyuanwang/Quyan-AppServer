import type { DeveloperProductCallLog } from "@prisma/client";
import type { IamPrincipal, DeveloperProductCode } from "@quyan/shared";
import type { DeveloperAccountReadTarget } from "./platform-developer-account-read.store";
import type { DeveloperUsageLocator } from "./platform-developer-usage-read.store";
export type DeveloperCallLogReadTarget = Pick<
  DeveloperProductCallLog,
  "id" | "status" | "entitlementId" | "createTime" | "updateTime"
>;
export type DeveloperCallLogReadRow = Omit<DeveloperProductCallLog, "details">;
export type DeveloperCallLogCursor = Pick<DeveloperCallLogReadTarget, "id" | "createTime">;
export interface PlatformDeveloperCallLogReadStore {
  target(
    principal: IamPrincipal,
    product: DeveloperProductCode,
    locator: DeveloperUsageLocator,
  ): Promise<DeveloperAccountReadTarget | null>;
  recheckAccount(principal: IamPrincipal, target: DeveloperAccountReadTarget): Promise<void>;
  scan(
    principal: IamPrincipal,
    account: DeveloperAccountReadTarget,
    after?: DeveloperCallLogCursor,
  ): Promise<DeveloperCallLogReadTarget[]>;
  hydrate(
    principal: IamPrincipal,
    account: DeveloperAccountReadTarget,
    targets: readonly DeveloperCallLogReadTarget[],
  ): Promise<DeveloperCallLogReadRow[]>;
  recheck(
    principal: IamPrincipal,
    account: DeveloperAccountReadTarget,
    targets: readonly DeveloperCallLogReadTarget[],
  ): Promise<DeveloperCallLogReadTarget[]>;
}
