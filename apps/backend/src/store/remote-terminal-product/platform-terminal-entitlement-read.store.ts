import type { RemoteTerminalUserEntitlement, RemoteTerminalEntitlementToken } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import type { PlatformCollectionStore, PlatformCollectionTarget } from "../system/platform-collection.store";
export interface TerminalEntitlementFilters {
  userId?: string;
  templateId?: string;
  status?: number;
}
export interface TerminalEntitlementTarget extends PlatformCollectionTarget {
  userId: string;
  templateId: string | null;
  assignedBy: string | null;
  tokenId: string | null;
  revision: string;
  displayOrder: number;
}
export type TerminalRegistrationMetadata = Omit<RemoteTerminalEntitlementToken, "token">;
export interface TerminalEntitlementProjection {
  username: boolean;
  templateName: boolean;
  assignedByUsername: boolean;
  tokenMetadata: boolean;
  registeredDeviceCount?: number;
}
export interface TerminalEntitlementReadView {
  record: RemoteTerminalUserEntitlement;
  username?: string;
  templateName?: string;
  assignedByUsername?: string;
  registrationToken?: TerminalRegistrationMetadata;
  registeredDeviceCount?: number;
}
export interface TerminalBindingReference {
  id: string;
  userId: string;
  entitlementId: string;
  status: number;
}
export interface PlatformTerminalEntitlementReadStore
  extends PlatformCollectionStore<TerminalEntitlementFilters, TerminalEntitlementFilters, TerminalEntitlementTarget> {
  scanDevices(target: TerminalEntitlementTarget, after?: string): Promise<TerminalBindingReference[]>;
  hydrate(
    principal: IamPrincipal,
    page: readonly { target: TerminalEntitlementTarget; projection: TerminalEntitlementProjection }[],
  ): Promise<TerminalEntitlementReadView[]>;
}
