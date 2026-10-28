import type { IamPrincipal } from "@quyan/shared";
import type { RedemptionCodeListItem } from "./redemption-code.store";
export interface RedemptionCodeReadTarget {
  id: string;
  status: number;
  createTime: Date;
  updateTime: Date;
  revision: string;
}
export interface PlatformRedemptionCodeReadStore {
  scan(principal: IamPrincipal, after?: string): Promise<RedemptionCodeReadTarget[]>;
  recheck(principal: IamPrincipal, targets: readonly RedemptionCodeReadTarget[]): Promise<RedemptionCodeReadTarget[]>;
  hydrate(principal: IamPrincipal, targets: readonly RedemptionCodeReadTarget[]): Promise<RedemptionCodeListItem[]>;
}
