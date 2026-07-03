import type { Prisma } from "@prisma/client";

export interface RemoteTerminalProductTemplateFilterOption {
  id: string;
  name: string;
  publishStatus: string;
  status: number;
}

export type RemoteTerminalProductTemplateRecord = Prisma.RemoteTerminalProductTemplateGetPayload<Record<string, never>>;

export type RemoteTerminalEntitlementWithRelations = Prisma.RemoteTerminalUserEntitlementGetPayload<{
  include: {
    template: true;
    registrationToken: true;
    user: { select: { username: true } };
    devices: { select: { id: true } };
  };
}>;

export type RemoteTerminalActiveEntitlementTokenRecord = Prisma.RemoteTerminalUserEntitlementGetPayload<{
  include: {
    template: true;
    registrationToken: true;
    devices: { select: { id: true } };
  };
}>;

export type RemoteTerminalDeviceBindingWithRelations = Prisma.RemoteTerminalDeviceBindingGetPayload<{
  include: {
    entitlement: {
      select: {
        id: true;
        userId: true;
        name: true;
        startAt: true;
        endAt: true;
        status: true;
        unbindResetAt: true;
      };
    };
    user: { select: { username: true } };
    registrationToken: true;
  };
}>;

export interface RemoteTerminalPurchaseEntitlementParams {
  userId: string;
  templateName: string;
  description?: string;
  entitlement: Prisma.RemoteTerminalUserEntitlementUncheckedCreateInput;
}

export interface RemoteTerminalPurchaseAndUpdateEntitlementParams {
  userId: string;
  templateName: string;
  description?: string;
  entitlementId: string;
  entitlement: Prisma.RemoteTerminalUserEntitlementUncheckedUpdateInput;
}

export interface RemoteTerminalProductStore {
  findTemplateById(id: string): Promise<RemoteTerminalProductTemplateRecord | null>;
  findTemplateByName(name: string): Promise<RemoteTerminalProductTemplateRecord | null>;
  createTemplate(
    data: Prisma.RemoteTerminalProductTemplateUncheckedCreateInput,
  ): Promise<RemoteTerminalProductTemplateRecord>;
  updateTemplate(
    id: string,
    data: Prisma.RemoteTerminalProductTemplateUncheckedUpdateInput,
  ): Promise<RemoteTerminalProductTemplateRecord>;
  softDeleteTemplate(id: string): Promise<RemoteTerminalProductTemplateRecord>;
  listPublishedTemplates(): Promise<RemoteTerminalProductTemplateRecord[]>;
  listTemplates(
    where: Prisma.RemoteTerminalProductTemplateWhereInput,
    page: number,
    pageSize: number,
  ): Promise<{ total: number; records: RemoteTerminalProductTemplateRecord[] }>;
  listTemplateFilterOptions(): Promise<RemoteTerminalProductTemplateFilterOption[]>;

  findEntitlementById(id: string): Promise<RemoteTerminalEntitlementWithRelations | null>;
  createEntitlement(
    data: Prisma.RemoteTerminalUserEntitlementUncheckedCreateInput,
  ): Promise<RemoteTerminalEntitlementWithRelations>;
  purchaseEntitlement(data: RemoteTerminalPurchaseEntitlementParams): Promise<RemoteTerminalEntitlementWithRelations>;
  purchaseAndUpdateEntitlement(
    data: RemoteTerminalPurchaseAndUpdateEntitlementParams,
  ): Promise<RemoteTerminalEntitlementWithRelations>;
  updateEntitlement(
    id: string,
    data: Prisma.RemoteTerminalUserEntitlementUncheckedUpdateInput,
  ): Promise<RemoteTerminalEntitlementWithRelations>;
  softDeleteEntitlement(id: string): Promise<Prisma.RemoteTerminalUserEntitlementGetPayload<Record<string, never>>>;
  listEntitlements(
    where: Prisma.RemoteTerminalUserEntitlementWhereInput,
    page: number,
    pageSize: number,
  ): Promise<{ total: number; records: RemoteTerminalEntitlementWithRelations[] }>;
  countUserEntitlementsInWindow(userId: string, templateId: string, startAt: Date): Promise<number>;
  sumActiveDeviceLimitForUser(userId: string, at: Date): Promise<number>;
  sumActiveTerminalLimitForUser(userId: string, at: Date): Promise<number>;

  findTokenByEntitlementId(
    entitlementId: string,
  ): Promise<Prisma.RemoteTerminalEntitlementTokenGetPayload<Record<string, never>> | null>;
  upsertEntitlementToken(
    entitlementId: string,
    data: Prisma.RemoteTerminalEntitlementTokenUncheckedCreateInput,
  ): Promise<Prisma.RemoteTerminalEntitlementTokenGetPayload<Record<string, never>>>;
  touchEntitlementToken(
    id: string,
    lastUsedAt: Date,
  ): Promise<Prisma.RemoteTerminalEntitlementTokenGetPayload<Record<string, never>>>;
  findActiveEntitlementByToken(token: string, at: Date): Promise<RemoteTerminalActiveEntitlementTokenRecord | null>;
  findActiveEntitlementById(
    entitlementId: string,
    at: Date,
  ): Promise<RemoteTerminalActiveEntitlementTokenRecord | null>;

  findDeviceBindingById(id: string): Promise<RemoteTerminalDeviceBindingWithRelations | null>;
  findDeviceBindingByDeviceId(deviceId: string): Promise<RemoteTerminalDeviceBindingWithRelations | null>;
  findDeviceBindingByEntitlementAndFingerprint(
    entitlementId: string,
    fingerprint: string,
  ): Promise<RemoteTerminalDeviceBindingWithRelations | null>;
  countRevokedDeviceBindingsForEntitlementInWindow(entitlementId: string, startAt: Date): Promise<number>;
  createDeviceBinding(
    data: Prisma.RemoteTerminalDeviceBindingUncheckedCreateInput,
  ): Promise<RemoteTerminalDeviceBindingWithRelations>;
  updateDeviceBinding(
    id: string,
    data: Prisma.RemoteTerminalDeviceBindingUncheckedUpdateInput,
  ): Promise<RemoteTerminalDeviceBindingWithRelations>;
  countActiveDeviceBindingsForEntitlement(entitlementId: string): Promise<number>;
  listDeviceBindings(
    where: Prisma.RemoteTerminalDeviceBindingWhereInput,
    page: number,
    pageSize: number,
  ): Promise<{ total: number; records: RemoteTerminalDeviceBindingWithRelations[] }>;
  listAccessibleDeviceBindings(userId: string, at: Date): Promise<RemoteTerminalDeviceBindingWithRelations[]>;
  findAccessibleDeviceBindingByDeviceId(
    userId: string,
    deviceId: string,
    at: Date,
  ): Promise<RemoteTerminalDeviceBindingWithRelations | null>;
}
