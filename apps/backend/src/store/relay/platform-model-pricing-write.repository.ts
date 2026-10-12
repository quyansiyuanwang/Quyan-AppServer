import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { iamAccountDenied } from "../users/iam-account-principal";
import { RECORD_STATUS } from "@/constant/status";
import { ConflictError } from "@/util/errors";
import {
  DEFAULT_CACHE_CREATION_MULTIPLIER,
  DEFAULT_CACHE_READ_MULTIPLIER,
  DEFAULT_MODEL_PRICING_SUPPORTED_FORMATS,
} from "@/constant/pricing";
import { isModelPricingRecordId } from "@/iam/resources/platform-model-pricing-resources";
import { normalizeModelPricingCreate, normalizeModelPricingUpdate } from "@/util/model-pricing-input";
import type { CreateModelPricingRequest, UpdateModelPricingRequest } from "@/api/dto/relay/model-pricing.dto";
import type {
  PlatformModelPricingWriteStore,
  PlatformModelPricingWriteGuard,
  ModelPricingWriteTarget,
} from "./platform-model-pricing-write.store";
const metadata = { id: true, model: true, status: true, updateTime: true } as const;
export class PlatformModelPricingWriteRepository implements PlatformModelPricingWriteStore {
  private static instance: PlatformModelPricingWriteRepository;
  private constructor() {}
  static getInstance() {
    return (this.instance ??= new PlatformModelPricingWriteRepository());
  }
  async target(principal: IamPrincipal, id: string) {
    await platformManagementGroupSnapshot(principal, Permission.MODEL_PRICING_UPDATE);
    if (!isModelPricingRecordId(id)) throw iamAccountDenied();
    return prisma.modelPricing.findFirst({ where: { id, status: 1 }, select: metadata });
  }
  private async identity(tx: Prisma.TransactionClient, guard: PlatformModelPricingWriteGuard) {
    if (
      guard.permission !== Permission.MODEL_PRICING_UPDATE ||
      guard.users.targetUserId !== guard.users.principal.subjectUserId
    )
      throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id = ${guard.group.id} FOR UPDATE`);
    const current = await platformManagementGroupSnapshot(guard.users.principal, Permission.MODEL_PRICING_UPDATE, tx);
    if (current.id !== guard.group.id || current.updateTime.getTime() !== guard.group.updateTime.getTime())
      throw iamAccountDenied();
  }
  private async transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new ConflictError("Model pricing context changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
  private prices(input: UpdateModelPricingRequest) {
    return {
      ...(input.inputPrice !== undefined ? { inputPrice: new Prisma.Decimal(input.inputPrice) } : {}),
      ...(input.outputPrice !== undefined ? { outputPrice: new Prisma.Decimal(input.outputPrice) } : {}),
      ...(input.fixedPrice !== undefined ? { fixedPrice: new Prisma.Decimal(input.fixedPrice) } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.pricingType !== undefined ? { pricingType: input.pricingType } : {}),
      ...(input.supportedFormats !== undefined ? { supportedFormats: input.supportedFormats } : {}),
      ...(input.cacheCreationMultiplier !== undefined
        ? { cacheCreationMultiplier: new Prisma.Decimal(input.cacheCreationMultiplier) }
        : {}),
      ...(input.cacheReadMultiplier !== undefined
        ? { cacheReadMultiplier: new Prisma.Decimal(input.cacheReadMultiplier) }
        : {}),
      ...(input.provider !== undefined ? { provider: input.provider } : {}),
    };
  }
  async create(input: CreateModelPricingRequest, guard: PlatformModelPricingWriteGuard) {
    const data = normalizeModelPricingCreate(input);
    return this.transaction(async (tx) => {
      await this.identity(tx, guard);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM model_pricing WHERE model = ${data.model} FOR UPDATE`);
      const existing = await tx.modelPricing.findUnique({ where: { model: data.model } });
      if (existing?.status === RECORD_STATUS.ACTIVE)
        throw new ConflictError("Model pricing already exists", undefined, { messageKey: "errors.conflict" });
      if (existing) await guard.recheckEntry(existing.id);
      const values = {
        ...this.prices(data),
        model: data.model,
        pricingType: data.pricingType,
        inputPrice: new Prisma.Decimal(data.inputPrice),
        outputPrice: new Prisma.Decimal(data.outputPrice),
        cacheCreationMultiplier: new Prisma.Decimal(data.cacheCreationMultiplier ?? DEFAULT_CACHE_CREATION_MULTIPLIER),
        cacheReadMultiplier: new Prisma.Decimal(data.cacheReadMultiplier ?? DEFAULT_CACHE_READ_MULTIPLIER),
        supportedFormats: data.supportedFormats || DEFAULT_MODEL_PRICING_SUPPORTED_FORMATS,
        status: RECORD_STATUS.ACTIVE,
      };
      const row = existing
        ? await tx.modelPricing.update({ where: { id: existing.id }, data: values })
        : await tx.modelPricing.create({ data: values });
      await guard.recheckEntry(row.id);
      await this.identity(tx, guard);
      await guard.recheckEntry(row.id);
      return row;
    });
  }
  private async locked(tx: Prisma.TransactionClient, target: ModelPricingWriteTarget) {
    if (!isModelPricingRecordId(target.id)) throw iamAccountDenied();
    await tx.$queryRaw(Prisma.sql`SELECT id FROM model_pricing WHERE id = ${target.id} FOR UPDATE`);
    const row = await tx.modelPricing.findUnique({ where: { id: target.id } });
    if (
      !row ||
      row.status !== 1 ||
      row.model !== target.model ||
      row.updateTime.getTime() !== target.updateTime.getTime()
    )
      throw iamAccountDenied();
    return row;
  }
  async update(
    target: ModelPricingWriteTarget,
    input: UpdateModelPricingRequest,
    guard: PlatformModelPricingWriteGuard,
  ) {
    const data = normalizeModelPricingUpdate(input);
    return this.transaction(async (tx) => {
      await this.identity(tx, guard);
      const current = await this.locked(tx, target);
      await guard.recheckEntry(current.id);
      const row = await tx.modelPricing.update({
        where: { id: current.id },
        data: this.prices(normalizeModelPricingUpdate(data, current)),
      });
      await this.identity(tx, guard);
      await guard.recheckEntry(row.id);
      return row;
    });
  }
  async remove(target: ModelPricingWriteTarget, guard: PlatformModelPricingWriteGuard) {
    return this.transaction(async (tx) => {
      await this.identity(tx, guard);
      const current = await this.locked(tx, target);
      await guard.recheckEntry(current.id);
      await tx.modelPricing.update({ where: { id: current.id }, data: { status: RECORD_STATUS.DELETED } });
      await this.identity(tx, guard);
      await guard.recheckEntry(current.id);
      return current;
    });
  }
}
