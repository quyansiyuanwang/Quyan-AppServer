import type { RemoteTerminalDeviceBinding } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import type { PlatformCollectionStore, PlatformCollectionTarget } from "../system/platform-collection.store";
export interface TerminalDeviceFilters {
  userId?: string;
  entitlementId?: string;
  status?: number;
}
export interface TerminalDeviceTarget extends PlatformCollectionTarget {
  userId: string;
  entitlementId: string;
  entitlementUserId: string;
  revision: string;
  displayOrder: number;
}
export interface TerminalDeviceProjection {
  username: boolean;
  entitlementName: boolean;
}
export type TerminalDevicePublicRecord = Omit<RemoteTerminalDeviceBinding, "heartbeatToken" | "snapshot">;
/** The selected columns cover the public record only; snapshot is projected separately to shells. */
export const PLATFORM_TERMINAL_DEVICE_PUBLIC_SELECT = {
  id: true,
  status: true,
  createTime: true,
  updateTime: true,
  entitlementId: true,
  userId: true,
  registrationTokenId: true,
  deviceId: true,
  fingerprint: true,
  fingerprintVersion: true,
  hostname: true,
  platform: true,
  arch: true,
  registeredAt: true,
  lastSeenAt: true,
  lastOnlineAt: true,
  online: true,
} as const;
export interface TerminalDeviceReadView {
  record: TerminalDevicePublicRecord;
  availableShells: unknown;
  username?: string;
  entitlementName?: string;
}
export interface PlatformTerminalDeviceReadStore
  extends PlatformCollectionStore<TerminalDeviceFilters, TerminalDeviceFilters, TerminalDeviceTarget> {
  hydrate(
    principal: IamPrincipal,
    page: readonly { target: TerminalDeviceTarget; projection: TerminalDeviceProjection }[],
  ): Promise<TerminalDeviceReadView[]>;
}
