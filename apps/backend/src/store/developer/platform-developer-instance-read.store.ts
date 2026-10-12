import type { DeveloperProductInstance } from "@prisma/client";
import type { IamPrincipal, DeveloperProductCode } from "@quyan/shared";
import type { DeveloperAccountReadTarget } from "./platform-developer-account-read.store";
import type { DeveloperUsageLocator } from "./platform-developer-usage-read.store";
export type DeveloperInstanceReadTarget = Pick<
  DeveloperProductInstance,
  "id" | "status" | "entitlementId" | "backingProjectId" | "createTime" | "updateTime"
> & {
  backingProject: { id: string; status: number; userId: string; updateTime: Date };
};
export type DeveloperInstanceReadRow = DeveloperInstanceReadTarget &
  Pick<DeveloperProductInstance, "name" | "slug" | "enabled">;
export type DeveloperInstanceCursor = Pick<DeveloperInstanceReadTarget, "id" | "createTime">;
export interface PlatformDeveloperInstanceReadStore {
  target(
    principal: IamPrincipal,
    product: DeveloperProductCode,
    locator: DeveloperUsageLocator,
  ): Promise<DeveloperAccountReadTarget | null>;
  recheckAccount(principal: IamPrincipal, target: DeveloperAccountReadTarget): Promise<void>;
  scan(
    principal: IamPrincipal,
    account: DeveloperAccountReadTarget,
    after?: DeveloperInstanceCursor,
  ): Promise<DeveloperInstanceReadTarget[]>;
  hydrate(
    principal: IamPrincipal,
    account: DeveloperAccountReadTarget,
    targets: readonly DeveloperInstanceReadTarget[],
  ): Promise<DeveloperInstanceReadRow[]>;
  recheck(
    principal: IamPrincipal,
    account: DeveloperAccountReadTarget,
    targets: readonly DeveloperInstanceReadTarget[],
  ): Promise<DeveloperInstanceReadTarget[]>;
}
