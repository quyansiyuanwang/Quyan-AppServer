import type { IamPrincipal } from "@quyan/shared";
import type { PlatformManagementPermissions } from "../users/platform-management-principal";
export interface PlatformManagementReadSnapshot {
  group: { id: string; updateTime: Date };
  users: { id: string; updateTime: Date }[];
}
export interface PlatformManagementReadStore {
  snapshot(principal: IamPrincipal, permission: PlatformManagementPermissions): Promise<PlatformManagementReadSnapshot>;
  recheck(
    principal: IamPrincipal,
    permission: PlatformManagementPermissions,
    expected: PlatformManagementReadSnapshot,
  ): Promise<void>;
}
