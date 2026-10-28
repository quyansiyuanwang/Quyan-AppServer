import type { DeveloperProductEntitlement } from "@prisma/client";
import type { IamPrincipal, DeveloperProductCode } from "@quyan/shared";
export type DeveloperAccountReadTarget = Pick<
  DeveloperProductEntitlement,
  "id" | "status" | "productCode" | "accountOwnerId" | "createTime" | "updateTime"
> & {
  accountOwner: { id: string; status: number; userType: string; accountOwnerId: string | null; updateTime: Date };
};
export type DeveloperAccountReadRow = DeveloperProductEntitlement & {
  accountOwner: DeveloperAccountReadTarget["accountOwner"] & { username: string; displayName: string | null };
};
export interface PlatformDeveloperAccountReadStore {
  scan(principal: IamPrincipal, after?: string, product?: DeveloperProductCode): Promise<DeveloperAccountReadTarget[]>;
  recheck(
    principal: IamPrincipal,
    targets: readonly DeveloperAccountReadTarget[],
  ): Promise<DeveloperAccountReadTarget[]>;
  hydrate(principal: IamPrincipal, targets: readonly DeveloperAccountReadTarget[]): Promise<DeveloperAccountReadRow[]>;
}
