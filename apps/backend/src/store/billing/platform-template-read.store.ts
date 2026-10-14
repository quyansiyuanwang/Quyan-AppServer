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
}
export interface PlatformTemplateRecordMap {
  "remote-terminal": RemoteTerminalProductTemplate;
  carpool: CarpoolPackageTemplate;
}
export interface PlatformTemplateReadStore<K extends IamPlatformTemplateKind>
  extends PlatformCollectionStore<PlatformTemplateFilters, PlatformTemplateFilters, PlatformTemplateTarget> {
  hydrate(principal: IamPrincipal, targets: readonly PlatformTemplateTarget[]): Promise<PlatformTemplateRecordMap[K][]>;
}
