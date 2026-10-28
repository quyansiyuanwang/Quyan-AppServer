import { Prisma } from "@prisma/client";
import { Permission, isDeveloperProductCode, type IamPrincipal, type DeveloperProductCode } from "@quyan/shared";
import { prisma } from "@/config/database";
import { updateProductAccountBodySchema } from "@/api/schema/developer/product-platform.schema";
import type { UpdateDeveloperProductAccountDto } from "@/api/dto/developer/product-platform.dto";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { iamAccountDenied } from "../users/iam-account-principal";
import { isDeveloperAccountRecordId } from "@/iam/resources/platform-developer-account-resources";
import { BadRequestError, ConflictError } from "@/util/errors";
import type {
  PlatformDeveloperAccountWriteStore,
  PlatformDeveloperAccountWriteGuard,
  DeveloperAccountWritePreparation,
} from "./platform-developer-account-write.store";
const targetMetadata = { id: true, productCode: true, accountOwnerId: true, status: true, updateTime: true } as const;
const ownerMetadata = { id: true, status: true, userType: true, accountOwnerId: true, updateTime: true } as const;
export class PlatformDeveloperAccountWriteRepository implements PlatformDeveloperAccountWriteStore {
  private static instance: PlatformDeveloperAccountWriteRepository;
  private constructor() {}
  static getInstance() {
    return (this.instance ??= new PlatformDeveloperAccountWriteRepository());
  }
  private async context(
    product: DeveloperProductCode,
    ownerId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<DeveloperAccountWritePreparation> {
    if (!isDeveloperProductCode(product) || !isDeveloperAccountRecordId(ownerId)) throw iamAccountDenied();
    const owner = await tx.user.findFirst({
      where: { id: ownerId, status: 1, userType: "root" },
      select: ownerMetadata,
    });
    if (!owner || (owner.accountOwnerId !== null && owner.accountOwnerId !== owner.id)) throw iamAccountDenied();
    const config = await tx.developerProductConfig.findFirst({
      where: { productCode: product, status: 1 },
      select: { id: true, status: true, productCode: true, updateTime: true },
    });
    if (!config) throw iamAccountDenied();
    const target = await tx.developerProductEntitlement.findUnique({
      where: { accountOwnerId_productCode: { accountOwnerId: ownerId, productCode: product } },
      select: targetMetadata,
    });
    return { owner, config, target };
  }
  async prepare(principal: IamPrincipal, product: DeveloperProductCode, ownerId: string) {
    await platformManagementGroupSnapshot(principal, Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE);
    return this.context(product, ownerId);
  }
  private async identity(tx: Prisma.TransactionClient, guard: PlatformDeveloperAccountWriteGuard) {
    if (
      guard.permission !== Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE ||
      guard.users.targetUserId !== guard.users.principal.subjectUserId
    )
      throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id = ${guard.group.id} FOR UPDATE`);
    const group = await platformManagementGroupSnapshot(
      guard.users.principal,
      Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE,
      tx,
    );
    if (group.id !== guard.group.id || group.updateTime.getTime() !== guard.group.updateTime.getTime())
      throw iamAccountDenied();
  }
  private same(current: DeveloperAccountWritePreparation, expected: DeveloperAccountWritePreparation) {
    if (
      current.owner.id !== expected.owner.id ||
      current.owner.accountOwnerId !== expected.owner.accountOwnerId ||
      current.owner.updateTime.getTime() !== expected.owner.updateTime.getTime() ||
      current.config.id !== expected.config.id ||
      current.config.updateTime.getTime() !== expected.config.updateTime.getTime() ||
      (!expected.target
        ? current.target !== null
        : !current.target ||
          current.target.id !== expected.target.id ||
          current.target.productCode !== expected.target.productCode ||
          current.target.accountOwnerId !== expected.target.accountOwnerId ||
          current.target.status !== expected.target.status ||
          current.target.updateTime.getTime() !== expected.target.updateTime.getTime())
    )
      throw iamAccountDenied();
  }
  async upsert(
    product: DeveloperProductCode,
    ownerId: string,
    input: UpdateDeveloperProductAccountDto,
    expected: DeveloperAccountWritePreparation,
    guard: PlatformDeveloperAccountWriteGuard,
  ) {
    const parsed = updateProductAccountBodySchema.strict().safeParse(input);
    if (!parsed.success)
      throw new BadRequestError("Invalid product account configuration", undefined, {
        messageKey: "errors.badRequest",
      });
    if (
      expected.owner.id !== ownerId ||
      expected.config.productCode !== product ||
      !isDeveloperAccountRecordId(expected.config.id)
    )
      throw iamAccountDenied();
    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.identity(tx, guard);
          await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${ownerId} FOR UPDATE`);
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM developer_product_configs WHERE id = ${expected.config.id} FOR UPDATE`,
          );
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM developer_product_entitlements WHERE accountOwnerId = ${ownerId} AND productCode = ${product} FOR UPDATE`,
          );
          const current = await this.context(product, ownerId, tx);
          this.same(current, expected);
          if (current.target) await guard.recheckEntry(current.target.id);
          const values = {
            dailyFreeQuota: parsed.data.dailyFreeQuota,
            overageEnabled: parsed.data.overageEnabled,
            instanceLimit: parsed.data.instanceLimit,
            status: 1,
          };
          const row = current.target
            ? await tx.developerProductEntitlement.update({
                where: { id: current.target.id },
                data: values,
                include: { accountOwner: { select: { ...ownerMetadata, username: true, displayName: true } } },
              })
            : await tx.developerProductEntitlement.create({
                data: {
                  ...values,
                  accountOwnerId: ownerId,
                  productCode: product,
                  enabled: true,
                  startsAt: null,
                  expiresAt: null,
                  issuedByUserId: guard.users.principal.subjectUserId,
                },
                include: { accountOwner: { select: { ...ownerMetadata, username: true, displayName: true } } },
              });
          await guard.recheckEntry(row.id);
          await this.identity(tx, guard);
          await guard.recheckEntry(row.id);
          return row;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new ConflictError("Product account context changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
}
