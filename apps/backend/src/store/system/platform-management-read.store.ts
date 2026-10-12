import type { IamPrincipal, Permission } from "@quyan/shared";
export interface PlatformManagementReadSnapshot {
  group: { id: string; updateTime: Date };
  users: { id: string; updateTime: Date }[];
}
export interface PlatformManagementReadStore {
  snapshot(principal: IamPrincipal, permission: Permission): Promise<PlatformManagementReadSnapshot>;
  recheck(principal: IamPrincipal, permission: Permission, expected: PlatformManagementReadSnapshot): Promise<void>;
}
