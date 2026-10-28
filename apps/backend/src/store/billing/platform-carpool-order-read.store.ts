import type { IamPrincipal } from "@quyan/shared";
import type { CarpoolOrderRecord } from "./carpool.repository";
export interface PlatformCarpoolOrderFilters {
  state?: string;
  keyword?: string;
  page: number;
  pageSize: number;
}
export interface PlatformCarpoolOrderPage {
  total: number;
  stateCounts: Record<string, number>;
  records: CarpoolOrderRecord[];
}
export interface PlatformCarpoolOrderReadStore {
  list(
    principal: IamPrincipal,
    filters: PlatformCarpoolOrderFilters,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
  ): Promise<PlatformCarpoolOrderPage>;
  get(
    principal: IamPrincipal,
    id: string,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
  ): Promise<CarpoolOrderRecord>;
}
