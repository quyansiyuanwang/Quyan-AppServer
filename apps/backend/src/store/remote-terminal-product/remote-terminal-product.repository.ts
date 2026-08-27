import { prisma } from "@/config/database";
import { MANAGED_STATUS } from "@/constant/status";
import { BadRequestError } from "@/util/errors";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import type {
  RemoteTerminalActiveEntitlementTokenRecord,
  RemoteTerminalDeviceBindingWithRelations,
  RemoteTerminalEntitlementWithRelations,
  RemoteTerminalPurchaseAndUpdateEntitlementParams,
  RemoteTerminalPurchaseEntitlementParams,
  RemoteTerminalProductStore,
  RemoteTerminalProductTemplateRecord,
  RemoteTerminalProductTemplateFilterOption,
} from "./remote-terminal-product.store";
import { applyBalanceAccountMutation } from "@/store/billing/balance-account-mutation";

type RemoteTerminalUserEntitlementRecord = Prisma.RemoteTerminalUserEntitlementGetPayload<Record<string, never>>;
type RemoteTerminalEntitlementTokenRecord = Prisma.RemoteTerminalEntitlementTokenGetPayload<Record<string, never>>;

const entitlementInclude = {
  template: true,
  registrationToken: true,
  user: { select: { username: true } },
  devices: {
    where: {
      status: {
        gte: MANAGED_STATUS.DISABLED,
      },
    },
    select: { id: true },
  },
} satisfies Prisma.RemoteTerminalUserEntitlementInclude;

const activeEntitlementTokenInclude = {
  template: true,
  registrationToken: true,
  devices: {
    where: {
      status: MANAGED_STATUS.ENABLED,
    },
    select: { id: true },
  },
} satisfies Prisma.RemoteTerminalUserEntitlementInclude;

const deviceInclude = {
  entitlement: {
    select: {
      id: true,
      userId: true,
      name: true,
      startAt: true,
      endAt: true,
      status: true,
      unbindResetAt: true,
    },
  },
  user: { select: { username: true } },
  registrationToken: true,
} satisfies Prisma.RemoteTerminalDeviceBindingInclude;

export class RemoteTerminalProductRepository implements RemoteTerminalProductStore {
  private static instance: RemoteTerminalProductRepository;

  public static getInstance(): RemoteTerminalProductRepository {
    if (!RemoteTerminalProductRepository.instance)
      RemoteTerminalProductRepository.instance = new RemoteTerminalProductRepository();

    return RemoteTerminalProductRepository.instance;
  }

  private async chargePurchase(
    tx: Prisma.TransactionClient,
    data: { userId: string; purchaseAmount: number; templateName: string },
  ): Promise<void> {
    if (data.purchaseAmount <= 0) return;

    const mutation = await applyBalanceAccountMutation(tx, {
      userId: data.userId,
      balanceDelta: new Decimal(-data.purchaseAmount),
      totalUsedDelta: new Decimal(data.purchaseAmount),
      minimumBalance: 0,
    });
    if (!mutation) throw new BadRequestError("Insufficient balance");

    await tx.balanceTransaction.create({
      data: {
        userId: data.userId,
        type: "remote_terminal_purchase",
        amount: new Decimal(-data.purchaseAmount),
        balanceBefore: mutation.balanceBefore,
        balanceAfter: mutation.balanceAfter,
        description: `远程终端购买: ${data.templateName}`,
        model: "remote_terminal_product",
      },
    });
  }

  async findTemplateById(id: string): Promise<RemoteTerminalProductTemplateRecord | null> {
    return prisma.remoteTerminalProductTemplate.findUnique({ where: { id } });
  }

  async findTemplateByName(name: string): Promise<RemoteTerminalProductTemplateRecord | null> {
    return prisma.remoteTerminalProductTemplate.findFirst({
      where: {
        name,
        status: { gte: MANAGED_STATUS.DISABLED },
      },
    });
  }

  async createTemplate(
    data: Prisma.RemoteTerminalProductTemplateUncheckedCreateInput,
  ): Promise<RemoteTerminalProductTemplateRecord> {
    return prisma.remoteTerminalProductTemplate.create({ data });
  }

  async updateTemplate(
    id: string,
    data: Prisma.RemoteTerminalProductTemplateUncheckedUpdateInput,
  ): Promise<RemoteTerminalProductTemplateRecord> {
    return prisma.remoteTerminalProductTemplate.update({ where: { id }, data });
  }

  async softDeleteTemplate(id: string): Promise<RemoteTerminalProductTemplateRecord> {
    return prisma.remoteTerminalProductTemplate.update({
      where: { id },
      data: { status: MANAGED_STATUS.DELETED, publishStatus: "draft", publishedAt: null },
    });
  }

  async listPublishedTemplates(): Promise<RemoteTerminalProductTemplateRecord[]> {
    return prisma.remoteTerminalProductTemplate.findMany({
      where: {
        status: MANAGED_STATUS.ENABLED,
        publishStatus: "published",
      },
      orderBy: [{ publishedAt: "desc" }, { updateTime: "desc" }],
    });
  }

  async listTemplates(
    where: Prisma.RemoteTerminalProductTemplateWhereInput,
    page: number,
    pageSize: number,
  ): Promise<{ total: number; records: RemoteTerminalProductTemplateRecord[] }> {
    const [total, records] = await Promise.all([
      prisma.remoteTerminalProductTemplate.count({ where }),
      prisma.remoteTerminalProductTemplate.findMany({
        where,
        orderBy: [{ updateTime: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { total, records };
  }

  async listTemplateFilterOptions(): Promise<RemoteTerminalProductTemplateFilterOption[]> {
    return prisma.remoteTerminalProductTemplate.findMany({
      where: {
        status: { gte: MANAGED_STATUS.DISABLED },
      },
      select: {
        id: true,
        name: true,
        publishStatus: true,
        status: true,
      },
      orderBy: [{ name: "asc" }],
    });
  }

  async findEntitlementById(id: string): Promise<RemoteTerminalEntitlementWithRelations | null> {
    return prisma.remoteTerminalUserEntitlement.findUnique({
      where: { id },
      include: entitlementInclude,
    }) as Promise<RemoteTerminalEntitlementWithRelations | null>;
  }

  async createEntitlement(
    data: Prisma.RemoteTerminalUserEntitlementUncheckedCreateInput,
  ): Promise<RemoteTerminalEntitlementWithRelations> {
    const created = await prisma.remoteTerminalUserEntitlement.create({ data });
    return prisma.remoteTerminalUserEntitlement.findUniqueOrThrow({
      where: { id: created.id },
      include: entitlementInclude,
    }) as Promise<RemoteTerminalEntitlementWithRelations>;
  }

  async purchaseEntitlement(
    data: RemoteTerminalPurchaseEntitlementParams,
  ): Promise<RemoteTerminalEntitlementWithRelations> {
    const created = await prisma.$transaction(async (tx) => {
      const purchaseAmount = Number(data.entitlement.purchaseAmount ?? 0);

      await this.chargePurchase(tx, {
        userId: data.userId,
        purchaseAmount,
        templateName: data.templateName,
      });

      return tx.remoteTerminalUserEntitlement.create({ data: data.entitlement });
    });

    return prisma.remoteTerminalUserEntitlement.findUniqueOrThrow({
      where: { id: created.id },
      include: entitlementInclude,
    }) as Promise<RemoteTerminalEntitlementWithRelations>;
  }

  async purchaseAndUpdateEntitlement(
    data: RemoteTerminalPurchaseAndUpdateEntitlementParams,
  ): Promise<RemoteTerminalEntitlementWithRelations> {
    await prisma.$transaction(async (tx) => {
      const purchaseAmount = Number(data.entitlement.purchaseAmount ?? 0);

      await this.chargePurchase(tx, {
        userId: data.userId,
        purchaseAmount,
        templateName: data.templateName,
      });

      await tx.remoteTerminalUserEntitlement.update({
        where: { id: data.entitlementId },
        data: data.entitlement,
      });
    });

    return prisma.remoteTerminalUserEntitlement.findUniqueOrThrow({
      where: { id: data.entitlementId },
      include: entitlementInclude,
    }) as Promise<RemoteTerminalEntitlementWithRelations>;
  }

  async updateEntitlement(
    id: string,
    data: Prisma.RemoteTerminalUserEntitlementUncheckedUpdateInput,
  ): Promise<RemoteTerminalEntitlementWithRelations> {
    await prisma.remoteTerminalUserEntitlement.update({ where: { id }, data });
    return prisma.remoteTerminalUserEntitlement.findUniqueOrThrow({
      where: { id },
      include: entitlementInclude,
    }) as Promise<RemoteTerminalEntitlementWithRelations>;
  }

  async softDeleteEntitlement(id: string): Promise<RemoteTerminalUserEntitlementRecord> {
    return prisma.remoteTerminalUserEntitlement.update({
      where: { id },
      data: { status: MANAGED_STATUS.DELETED },
    });
  }

  async listEntitlements(
    where: Prisma.RemoteTerminalUserEntitlementWhereInput,
    page: number,
    pageSize: number,
  ): Promise<{ total: number; records: RemoteTerminalEntitlementWithRelations[] }> {
    const [total, records] = await Promise.all([
      prisma.remoteTerminalUserEntitlement.count({ where }),
      prisma.remoteTerminalUserEntitlement.findMany({
        where,
        include: entitlementInclude,
        orderBy: [{ endAt: "asc" }, { updateTime: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { total, records: records as RemoteTerminalEntitlementWithRelations[] };
  }

  async countUserEntitlementsInWindow(userId: string, templateId: string, startAt: Date): Promise<number> {
    return prisma.remoteTerminalUserEntitlement.count({
      where: {
        userId,
        templateId,
        status: { gte: MANAGED_STATUS.DISABLED },
        createTime: { gte: startAt },
      },
    });
  }

  async sumActiveDeviceLimitForUser(userId: string, at: Date): Promise<number> {
    const result = await prisma.remoteTerminalUserEntitlement.aggregate({
      where: {
        userId,
        status: MANAGED_STATUS.ENABLED,
        startAt: { lte: at },
        endAt: { gte: at },
      },
      _sum: {
        deviceLimit: true,
      },
    });

    return result._sum.deviceLimit ?? 0;
  }

  async sumActiveTerminalLimitForUser(userId: string, at: Date): Promise<number> {
    const result = await prisma.remoteTerminalUserEntitlement.aggregate({
      where: {
        userId,
        status: MANAGED_STATUS.ENABLED,
        startAt: { lte: at },
        endAt: { gte: at },
      },
      _sum: {
        terminalLimit: true,
      },
    });

    return result._sum.terminalLimit ?? 0;
  }

  async findTokenByEntitlementId(entitlementId: string): Promise<RemoteTerminalEntitlementTokenRecord | null> {
    return prisma.remoteTerminalEntitlementToken.findUnique({
      where: { entitlementId },
    });
  }

  async upsertEntitlementToken(
    entitlementId: string,
    data: Prisma.RemoteTerminalEntitlementTokenUncheckedCreateInput,
  ): Promise<RemoteTerminalEntitlementTokenRecord> {
    const existing = await prisma.remoteTerminalEntitlementToken.findUnique({ where: { entitlementId } });
    if (!existing) return prisma.remoteTerminalEntitlementToken.create({ data });

    return prisma.remoteTerminalEntitlementToken.update({
      where: { entitlementId },
      data: {
        token: data.token,
        label: data.label ?? null,
        expiresAt: data.expiresAt ?? null,
        lastUsedAt: data.lastUsedAt ?? null,
        status: data.status,
      },
    });
  }

  async touchEntitlementToken(id: string, lastUsedAt: Date): Promise<RemoteTerminalEntitlementTokenRecord> {
    return prisma.remoteTerminalEntitlementToken.update({
      where: { id },
      data: { lastUsedAt },
    });
  }

  async findActiveEntitlementByToken(
    token: string,
    at: Date,
  ): Promise<RemoteTerminalActiveEntitlementTokenRecord | null> {
    const record = await prisma.remoteTerminalUserEntitlement.findFirst({
      where: {
        status: MANAGED_STATUS.ENABLED,
        startAt: { lte: at },
        endAt: { gte: at },
        registrationToken: {
          is: {
            token,
            status: MANAGED_STATUS.ENABLED,
            OR: [{ expiresAt: null }, { expiresAt: { gte: at } }],
          },
        },
      },
      include: activeEntitlementTokenInclude,
    });

    if (!record?.registrationToken) return null;
    return record as RemoteTerminalActiveEntitlementTokenRecord;
  }

  async findActiveEntitlementById(
    entitlementId: string,
    at: Date,
  ): Promise<RemoteTerminalActiveEntitlementTokenRecord | null> {
    const record = await prisma.remoteTerminalUserEntitlement.findFirst({
      where: {
        id: entitlementId,
        status: MANAGED_STATUS.ENABLED,
        startAt: { lte: at },
        endAt: { gte: at },
        registrationToken: {
          is: {
            status: MANAGED_STATUS.ENABLED,
            OR: [{ expiresAt: null }, { expiresAt: { gte: at } }],
          },
        },
      },
      include: activeEntitlementTokenInclude,
    });
    if (!record?.registrationToken) return null;
    return record as RemoteTerminalActiveEntitlementTokenRecord;
  }

  async findDeviceBindingById(id: string): Promise<RemoteTerminalDeviceBindingWithRelations | null> {
    return prisma.remoteTerminalDeviceBinding.findUnique({
      where: { id },
      include: deviceInclude,
    }) as Promise<RemoteTerminalDeviceBindingWithRelations | null>;
  }

  async findDeviceBindingByDeviceId(deviceId: string): Promise<RemoteTerminalDeviceBindingWithRelations | null> {
    return prisma.remoteTerminalDeviceBinding.findUnique({
      where: { deviceId },
      include: deviceInclude,
    }) as Promise<RemoteTerminalDeviceBindingWithRelations | null>;
  }

  async findDeviceBindingByEntitlementAndFingerprint(
    entitlementId: string,
    fingerprint: string,
  ): Promise<RemoteTerminalDeviceBindingWithRelations | null> {
    return prisma.remoteTerminalDeviceBinding.findFirst({
      where: {
        entitlementId,
        fingerprint,
      },
      include: deviceInclude,
    }) as Promise<RemoteTerminalDeviceBindingWithRelations | null>;
  }

  async countRevokedDeviceBindingsForEntitlementInWindow(entitlementId: string, startAt: Date): Promise<number> {
    return prisma.remoteTerminalDeviceBinding.count({
      where: {
        entitlementId,
        status: MANAGED_STATUS.DELETED,
        updateTime: { gte: startAt },
      },
    });
  }

  async createDeviceBinding(
    data: Prisma.RemoteTerminalDeviceBindingUncheckedCreateInput,
  ): Promise<RemoteTerminalDeviceBindingWithRelations> {
    const created = await prisma.remoteTerminalDeviceBinding.create({ data });
    return prisma.remoteTerminalDeviceBinding.findUniqueOrThrow({
      where: { id: created.id },
      include: deviceInclude,
    }) as Promise<RemoteTerminalDeviceBindingWithRelations>;
  }

  async updateDeviceBinding(
    id: string,
    data: Prisma.RemoteTerminalDeviceBindingUncheckedUpdateInput,
  ): Promise<RemoteTerminalDeviceBindingWithRelations> {
    await prisma.remoteTerminalDeviceBinding.update({ where: { id }, data });
    return prisma.remoteTerminalDeviceBinding.findUniqueOrThrow({
      where: { id },
      include: deviceInclude,
    }) as Promise<RemoteTerminalDeviceBindingWithRelations>;
  }

  async countActiveDeviceBindingsForEntitlement(entitlementId: string): Promise<number> {
    return prisma.remoteTerminalDeviceBinding.count({
      where: {
        entitlementId,
        status: MANAGED_STATUS.ENABLED,
      },
    });
  }

  async listDeviceBindings(
    where: Prisma.RemoteTerminalDeviceBindingWhereInput,
    page: number,
    pageSize: number,
  ): Promise<{ total: number; records: RemoteTerminalDeviceBindingWithRelations[] }> {
    const [total, records] = await Promise.all([
      prisma.remoteTerminalDeviceBinding.count({ where }),
      prisma.remoteTerminalDeviceBinding.findMany({
        where,
        include: deviceInclude,
        orderBy: [{ lastSeenAt: "desc" }, { updateTime: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { total, records: records as RemoteTerminalDeviceBindingWithRelations[] };
  }

  async listAccessibleDeviceBindings(userId: string, at: Date): Promise<RemoteTerminalDeviceBindingWithRelations[]> {
    const records = await prisma.remoteTerminalDeviceBinding.findMany({
      where: {
        userId,
        status: MANAGED_STATUS.ENABLED,
        entitlement: {
          status: MANAGED_STATUS.ENABLED,
          startAt: { lte: at },
          endAt: { gte: at },
        },
      },
      include: deviceInclude,
      orderBy: [{ online: "desc" }, { lastSeenAt: "desc" }],
    });

    return records as RemoteTerminalDeviceBindingWithRelations[];
  }

  async findAccessibleDeviceBindingByDeviceId(
    userId: string,
    deviceId: string,
    at: Date,
  ): Promise<RemoteTerminalDeviceBindingWithRelations | null> {
    return prisma.remoteTerminalDeviceBinding.findFirst({
      where: {
        userId,
        deviceId,
        status: MANAGED_STATUS.ENABLED,
        entitlement: {
          status: MANAGED_STATUS.ENABLED,
          startAt: { lte: at },
          endAt: { gte: at },
        },
      },
      include: deviceInclude,
    }) as Promise<RemoteTerminalDeviceBindingWithRelations | null>;
  }
}
