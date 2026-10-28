import type { MonthlyPassTemplateWithQuotaWindows } from "./monthly-pass.store";
import type { RemoteTerminalProductTemplate, CarpoolPackageTemplate } from "@prisma/client";
import type { IamPrincipal, IamPlatformTemplateKind } from "@quyan/shared";
import type { PlatformCollectionStore, PlatformCollectionTarget } from "../system/platform-collection.store";
export interface PlatformTemplateTarget extends PlatformCollectionTarget {
  revision: string;
  displayOrder: number;
}
export interface PlatformTemplateFilters {
  status?: number;
  keyword?: string;
  publishStatus?: string;
  order?: "name";
}
export interface PlatformTemplateRecordMap {
  "monthly-pass": MonthlyPassTemplateWithQuotaWindows;
  "remote-terminal": RemoteTerminalProductTemplate;
  carpool: CarpoolPackageTemplate;
}
export type PlatformTerminalTemplateOption = Pick<
  RemoteTerminalProductTemplate,
  "id" | "name" | "status" | "publishStatus"
>;
export interface PlatformTerminalTemplateOptionsStore {
  hydrateOptions(
    principal: IamPrincipal,
    targets: readonly PlatformTemplateTarget[],
  ): Promise<PlatformTerminalTemplateOption[]>;
}
export interface PlatformTemplateReadStore<K extends IamPlatformTemplateKind>
  extends PlatformCollectionStore<PlatformTemplateFilters, PlatformTemplateFilters, PlatformTemplateTarget> {
  hydrate(principal: IamPrincipal, targets: readonly PlatformTemplateTarget[]): Promise<PlatformTemplateRecordMap[K][]>;
}
