import type { IamPrincipal, DeveloperProductCode } from "@quyan/shared";
import type { DeveloperAccountReadRow } from "./platform-developer-account-read.store";
import type { DeveloperAccountWriteTarget } from "./platform-developer-account-write.store";
export interface DeveloperOwnerReadTarget {
  id: string;
  status: number;
  userType: string;
  accountOwnerId: string | null;
  createTime: Date;
  updateTime: Date;
  account: DeveloperAccountWriteTarget | null;
}
export interface DeveloperOwnerReadRow extends DeveloperOwnerReadTarget {
  username: string;
  displayName: string | null;
  accountRow: DeveloperAccountReadRow | null;
}
export type DeveloperOwnerCursor = Pick<DeveloperOwnerReadTarget, "id" | "createTime">;
export interface PlatformDeveloperOwnerReadStore {
  scan(
    principal: IamPrincipal,
    product: DeveloperProductCode,
    keyword?: string,
    after?: DeveloperOwnerCursor,
  ): Promise<DeveloperOwnerReadTarget[]>;
  recheck(
    principal: IamPrincipal,
    product: DeveloperProductCode,
    targets: readonly DeveloperOwnerReadTarget[],
  ): Promise<DeveloperOwnerReadTarget[]>;
  hydrate(
    principal: IamPrincipal,
    product: DeveloperProductCode,
    targets: readonly DeveloperOwnerReadTarget[],
  ): Promise<DeveloperOwnerReadRow[]>;
}
