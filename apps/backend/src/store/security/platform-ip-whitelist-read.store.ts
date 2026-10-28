import type { IPWhiteList } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
export type IpWhitelistReadTarget = Pick<IPWhiteList, "id" | "status" | "createTime" | "updateTime" | "expiresAt">;
export interface PlatformIpWhitelistReadStore {
  scan(principal: IamPrincipal, after?: string): Promise<IpWhitelistReadTarget[]>;
  target(principal: IamPrincipal, ip: string): Promise<IpWhitelistReadTarget | null>;
  recheck(principal: IamPrincipal, targets: readonly IpWhitelistReadTarget[]): Promise<IpWhitelistReadTarget[]>;
  hydrate(principal: IamPrincipal, targets: readonly IpWhitelistReadTarget[]): Promise<IPWhiteList[]>;
}
