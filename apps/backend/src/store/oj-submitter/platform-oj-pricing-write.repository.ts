import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { iamAccountDenied } from "../users/iam-account-principal";
import { RECORD_STATUS } from "@/constant/status";
import { BadRequestError, ConflictError } from "@/util/errors";
import { DEFAULT_CACHE_CREATION_MULTIPLIER, DEFAULT_CACHE_READ_MULTIPLIER } from "@/constant/pricing";
import { isOjPricingRecordId } from "@/iam/resources/platform-oj-pricing-resources";
import {
  createOJModelPricingBodySchema,
  updateOJModelPricingBodySchema,
} from "@/api/schema/oj-submitter/oj-submitter.schema";
import type { CreateOJModelPricingRequest, UpdateOJModelPricingRequest } from "@/api/dto/oj-submitter/oj-qa.dto";
import type {
  PlatformOjPricingWriteStore,
  PlatformOjPricingWriteGuard,
  OjPricingWriteTarget,
} from "./platform-oj-pricing-write.store";
const metadata = { id: true, model: true, status: true, updateTime: true } as const;
export class PlatformOjPricingWriteRepository implements PlatformOjPricingWriteStore {
  private static instance: PlatformOjPricingWriteRepository;
  private constructor() {}
  static getInstance() {
    return (this.instance ??= new PlatformOjPricingWriteRepository());
  }
  async target(principal: IamPrincipal, model: string) {
    await platformManagementGroupSnapshot(principal, Permission.OJ_PRICING_UPDATE);
    return prisma.oJModelPricing.findFirst({ where: { model, status: 1 }, select: metadata });
  }
  private async identity(tx: Prisma.TransactionClient, guard: PlatformOjPricingWriteGuard) {
    if (
      guard.permission !== Permission.OJ_PRICING_UPDATE ||
      guard.users.targetUserId !== guard.users.principal.subjectUserId
    )
      throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id = ${guard.group.id} FOR UPDATE`);
    const current = await platformManagementGroupSnapshot(guard.users.principal, Permission.OJ_PRICING_UPDATE, tx);
    if (current.id !== guard.group.id || current.updateTime.getTime() !== guard.group.updateTime.getTime())
      throw iamAccountDenied();
  }
  private async transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new ConflictError("OJ pricing context changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
  private prices(input: UpdateOJModelPricingRequest) {
    return {
      ...(input.inputPrice !== undefined ? { inputPrice: new Prisma.Decimal(input.inputPrice) } : {}),
      ...(input.outputPrice !== undefined ? { outputPrice: new Prisma.Decimal(input.outputPrice) } : {}),
      ...(input.multiplier !== undefined ? { multiplier: new Prisma.Decimal(input.multiplier) } : {}),
      ...(input.cacheCreationMultiplier !== undefined
        ? { cacheCreationMultiplier: new Prisma.Decimal(input.cacheCreationMultiplier) }
        : {}),
      ...(input.cacheReadMultiplier !== undefined
        ? { cacheReadMultiplier: new Prisma.Decimal(input.cacheReadMultiplier) }
        : {}),
      ...(input.provider !== undefined ? { provider: input.provider } : {}),
    };
  }
  async create(input: CreateOJModelPricingRequest, guard: PlatformOjPricingWriteGuard) {
    const parsed = createOJModelPricingBodySchema.strict().safeParse(input);
    if (!parsed.success) throw iamAccountDenied();
    const data = parsed.data;
    return this.transaction(async (tx) => {
      await this.identity(tx, guard);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM oj_model_pricing WHERE model = ${data.model} FOR UPDATE`);
      if (await tx.oJModelPricing.findUnique({ where: { model: data.model } }))
        throw new BadRequestError("OJ model pricing already exists", undefined, {
          messageKey: "ojSubmitter.pricingEntryAlreadyExists",
        });
      const row = await tx.oJModelPricing.create({
        data: {
          model: data.model,
          inputPrice: new Prisma.Decimal(data.inputPrice),
          outputPrice: new Prisma.Decimal(data.outputPrice),
          multiplier: new Prisma.Decimal(data.multiplier ?? 1),
          cacheCreationMultiplier: new Prisma.Decimal(
            data.cacheCreationMultiplier ?? DEFAULT_CACHE_CREATION_MULTIPLIER,
          ),
          cacheReadMultiplier: new Prisma.Decimal(data.cacheReadMultiplier ?? DEFAULT_CACHE_READ_MULTIPLIER),
          provider: data.provider,
        },
      });
      await guard.recheckEntry(row.id);
      await this.identity(tx, guard);
      await guard.recheckEntry(row.id);
      return row;
    });
  }
  private async locked(tx: Prisma.TransactionClient, target: OjPricingWriteTarget) {
    if (!isOjPricingRecordId(target.id)) throw iamAccountDenied();
    await tx.$queryRaw(Prisma.sql`SELECT id FROM oj_model_pricing WHERE id = ${target.id} FOR UPDATE`);
    const row = await tx.oJModelPricing.findUnique({ where: { id: target.id } });
    if (
      !row ||
      row.status !== 1 ||
      row.model !== target.model ||
      row.updateTime.getTime() !== target.updateTime.getTime()
    )
      throw iamAccountDenied();
    return row;
  }
  async update(target: OjPricingWriteTarget, input: UpdateOJModelPricingRequest, guard: PlatformOjPricingWriteGuard) {
    const parsed = updateOJModelPricingBodySchema.strict().safeParse(input);
    if (!parsed.success) throw iamAccountDenied();
    return this.transaction(async (tx) => {
      await this.identity(tx, guard);
      const current = await this.locked(tx, target);
      await guard.recheckEntry(current.id);
      const row = await tx.oJModelPricing.update({ where: { id: current.id }, data: this.prices(parsed.data) });
      await this.identity(tx, guard);
      await guard.recheckEntry(row.id);
      return row;
    });
  }
  async remove(target: OjPricingWriteTarget, guard: PlatformOjPricingWriteGuard) {
    return this.transaction(async (tx) => {
      await this.identity(tx, guard);
      const current = await this.locked(tx, target);
      await guard.recheckEntry(current.id);
      await tx.oJModelPricing.update({ where: { id: current.id }, data: { status: RECORD_STATUS.DELETED } });
      await this.identity(tx, guard);
      await guard.recheckEntry(current.id);
      return current;
    });
  }
}
