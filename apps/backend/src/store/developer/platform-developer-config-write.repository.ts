import { Prisma } from "@prisma/client";
import { Permission, isDeveloperProductCode, type IamPrincipal, type DeveloperProductCode } from "@quyan/shared";
import { prisma } from "@/config/database";
import { updateProductConfigBodySchema } from "@/api/schema/developer/product-platform.schema";
import type { UpdateDeveloperProductConfigDto } from "@/api/dto/developer/product-platform.dto";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { iamAccountDenied } from "../users/iam-account-principal";
import { isDeveloperConfigRecordId } from "@/iam/resources/platform-developer-config-resources";
import { BadRequestError, ConflictError } from "@/util/errors";
import type {
  DeveloperConfigWriteTarget,
  PlatformDeveloperConfigWriteStore,
  PlatformDeveloperConfigWriteGuard,
} from "./platform-developer-config-write.store";
const metadata = { id: true, productCode: true, status: true, updateTime: true } as const;
export class PlatformDeveloperConfigWriteRepository implements PlatformDeveloperConfigWriteStore {
  private static instance: PlatformDeveloperConfigWriteRepository;
  private constructor() {}
  static getInstance() {
    return (this.instance ??= new PlatformDeveloperConfigWriteRepository());
  }
  async target(principal: IamPrincipal, product: DeveloperProductCode) {
    if (!isDeveloperProductCode(product)) throw iamAccountDenied();
    await platformManagementGroupSnapshot(principal, Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE);
    return prisma.developerProductConfig.findUnique({ where: { productCode: product }, select: metadata });
  }
  private async identity(tx: Prisma.TransactionClient, guard: PlatformDeveloperConfigWriteGuard) {
    if (
      guard.permission !== Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE ||
      guard.users.targetUserId !== guard.users.principal.subjectUserId
    )
      throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id = ${guard.group.id} FOR UPDATE`);
    const group = await platformManagementGroupSnapshot(
      guard.users.principal,
      Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE,
      tx,
    );
    if (group.id !== guard.group.id || group.updateTime.getTime() !== guard.group.updateTime.getTime())
      throw iamAccountDenied();
  }
  private same(
    current: DeveloperConfigWriteTarget | null,
    expected: DeveloperConfigWriteTarget | null,
    product: DeveloperProductCode,
  ) {
    if (current === null && expected === null) return;
    if (
      !current ||
      !expected ||
      !isDeveloperConfigRecordId(expected.id) ||
      current.id !== expected.id ||
      current.productCode !== product ||
      expected.productCode !== product ||
      current.status !== expected.status ||
      !(expected.updateTime instanceof Date) ||
      current.updateTime.getTime() !== expected.updateTime.getTime()
    )
      throw iamAccountDenied();
  }
  async upsert(
    product: DeveloperProductCode,
    input: UpdateDeveloperProductConfigDto,
    expected: DeveloperConfigWriteTarget | null,
    guard: PlatformDeveloperConfigWriteGuard,
  ) {
    const parsed = updateProductConfigBodySchema.strict().safeParse(input);
    if (!isDeveloperProductCode(product) || !parsed.success)
      throw new BadRequestError("Invalid product configuration", undefined, { messageKey: "errors.badRequest" });
    const body = parsed.data;
    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.identity(tx, guard);
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM developer_product_configs WHERE productCode = ${product} FOR UPDATE`,
          );
          const current = await tx.developerProductConfig.findUnique({
            where: { productCode: product },
            select: metadata,
          });
          this.same(current, expected, product);
          if (current) await guard.recheckEntry(current.id);
          const values = {
            enabled: body.enabled,
            defaultDailyQuota: body.defaultDailyQuota,
            overagePrice: new Prisma.Decimal(body.overagePrice),
            defaultInstanceLimit: body.defaultInstanceLimit,
            retentionDays: body.retentionDays,
            ...(body.resourceLimits !== undefined
              ? { resourceLimits: body.resourceLimits as Prisma.InputJsonObject }
              : {}),
            ...(body.settings !== undefined ? { settings: body.settings as Prisma.InputJsonObject } : {}),
            status: 1,
          };
          const row = current
            ? await tx.developerProductConfig.update({ where: { id: current.id }, data: values })
            : await tx.developerProductConfig.create({ data: { ...values, productCode: product } });
          await guard.recheckEntry(row.id);
          await this.identity(tx, guard);
          await guard.recheckEntry(row.id);
          return row;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new ConflictError("Product configuration context changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
}
