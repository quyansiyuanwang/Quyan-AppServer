import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { upsertQuotaOverrideBodySchema } from "@/api/schema/developer/developer.schema";
import type { UpsertDeveloperQuotaOverrideDto } from "@/api/dto/developer/developer.dto";
import { isDeveloperQuotaRecordId } from "@/iam/resources/platform-developer-quota-resources";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { iamAccountDenied } from "../users/iam-account-principal";
import { BadRequestError, ConflictError } from "@/util/errors";
import type {
  DeveloperQuotaSubjectSnapshot,
  DeveloperQuotaWritePreparation,
  DeveloperQuotaWriteTarget,
  PlatformDeveloperQuotaWriteStore,
  PlatformDeveloperQuotaWriteGuard,
} from "./platform-developer-quota-write.store";
const metadata = {
  id: true,
  subjectType: true,
  subjectId: true,
  service: true,
  status: true,
  updateTime: true,
} as const;
export class PlatformDeveloperQuotaWriteRepository implements PlatformDeveloperQuotaWriteStore {
  private static instance: PlatformDeveloperQuotaWriteRepository;
  private constructor() {}
  static getInstance() {
    return (this.instance ??= new PlatformDeveloperQuotaWriteRepository());
  }
  private async subject(
    body: UpsertDeveloperQuotaOverrideDto,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<DeveloperQuotaSubjectSnapshot> {
    if (!isDeveloperQuotaRecordId(body.subjectId)) throw iamAccountDenied();
    const project =
      body.subjectType === "project"
        ? await tx.developerProject.findFirst({
            where: { id: body.subjectId, status: 1 },
            select: { id: true, userId: true, updateTime: true },
          })
        : undefined;
    if (body.subjectType === "project" && !project) throw iamAccountDenied();
    const userId = project?.userId ?? body.subjectId;
    const user = await tx.user.findFirst({
      where: { id: userId, status: 1 },
      select: { id: true, accountOwnerId: true, updateTime: true },
    });
    if (!user) throw iamAccountDenied();
    const ids = [...new Set([user.id, user.accountOwnerId ?? user.id])];
    const users = await tx.user.findMany({
      where: { id: { in: ids }, status: 1 },
      select: { id: true, updateTime: true, accountOwnerId: true },
    });
    if (
      users.length !== ids.length ||
      (user.accountOwnerId && !users.some((row) => row.id === user.accountOwnerId && row.accountOwnerId === null))
    )
      throw iamAccountDenied();
    return {
      subjectType: body.subjectType,
      subjectId: body.subjectId,
      service: body.service ?? "*",
      users,
      ...(project ? { project } : {}),
    };
  }
  async prepare(principal: IamPrincipal, input: UpsertDeveloperQuotaOverrideDto) {
    const body = upsertQuotaOverrideBodySchema.strict().parse(input);
    await platformManagementGroupSnapshot(principal, Permission.DEVELOPER_QUOTA_MANAGE);
    const subject = await this.subject(body);
    const target = await prisma.developerQuotaOverride.findUnique({
      where: {
        subjectType_subjectId_service: {
          subjectType: subject.subjectType,
          subjectId: subject.subjectId,
          service: subject.service,
        },
      },
      select: metadata,
    });
    return { subject, target };
  }
  async target(principal: IamPrincipal, id: string) {
    if (!isDeveloperQuotaRecordId(id)) throw iamAccountDenied();
    await platformManagementGroupSnapshot(principal, Permission.DEVELOPER_QUOTA_MANAGE);
    return prisma.developerQuotaOverride.findFirst({ where: { id, status: 1 }, select: metadata });
  }
  private async identity(tx: Prisma.TransactionClient, guard: PlatformDeveloperQuotaWriteGuard) {
    if (
      guard.permission !== Permission.DEVELOPER_QUOTA_MANAGE ||
      guard.users.targetUserId !== guard.users.principal.subjectUserId
    )
      throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id = ${guard.group.id} FOR UPDATE`);
    const group = await platformManagementGroupSnapshot(guard.users.principal, Permission.DEVELOPER_QUOTA_MANAGE, tx);
    if (group.id !== guard.group.id || group.updateTime.getTime() !== guard.group.updateTime.getTime())
      throw iamAccountDenied();
  }
  private async transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new ConflictError("Quota context changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
  private same(row: DeveloperQuotaWriteTarget | null, expected: DeveloperQuotaWriteTarget | null) {
    if (
      !expected
        ? Boolean(row)
        : !row ||
          row.id !== expected.id ||
          row.subjectType !== expected.subjectType ||
          row.subjectId !== expected.subjectId ||
          row.service !== expected.service ||
          row.status !== expected.status ||
          row.updateTime.getTime() !== expected.updateTime.getTime()
    )
      throw iamAccountDenied();
  }
  async upsert(
    input: UpsertDeveloperQuotaOverrideDto,
    preparation: DeveloperQuotaWritePreparation,
    guard: PlatformDeveloperQuotaWriteGuard,
  ) {
    const parsed = upsertQuotaOverrideBodySchema.strict().safeParse(input);
    if (!parsed.success) throw iamAccountDenied();
    const body = parsed.data,
      expected = preparation.subject;
    if (
      body.subjectType !== expected.subjectType ||
      body.subjectId !== expected.subjectId ||
      (body.service ?? "*") !== expected.service
    )
      throw iamAccountDenied();
    return this.transaction(async (tx) => {
      await this.identity(tx, guard);
      const ids = expected.users.map((row) => row.id).sort();
      if (!ids.length) throw iamAccountDenied();
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
      if (expected.project)
        await tx.$queryRaw(Prisma.sql`SELECT id FROM developer_projects WHERE id = ${expected.project.id} FOR UPDATE`);
      const current = await this.subject(body, tx);
      if (
        current.users.length !== expected.users.length ||
        current.users.some(
          (row) =>
            !expected.users.some(
              (old) =>
                old.id === row.id &&
                old.accountOwnerId === row.accountOwnerId &&
                old.updateTime.getTime() === row.updateTime.getTime(),
            ),
        ) ||
        (current.project
          ? !expected.project ||
            current.project.id !== expected.project.id ||
            current.project.userId !== expected.project.userId ||
            current.project.updateTime.getTime() !== expected.project.updateTime.getTime()
          : Boolean(expected.project))
      )
        throw iamAccountDenied();
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM developer_quota_overrides WHERE subjectType = ${body.subjectType} AND subjectId = ${body.subjectId} AND service = ${expected.service} FOR UPDATE`,
      );
      const where = {
        subjectType_subjectId_service: {
          subjectType: body.subjectType,
          subjectId: body.subjectId,
          service: expected.service,
        },
      };
      const existing = await tx.developerQuotaOverride.findUnique({ where, select: metadata });
      this.same(existing, preparation.target);
      if (existing) await guard.recheckEntry(existing.id);
      const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
      if (expiresAt && expiresAt.getTime() <= Date.now())
        throw new BadRequestError("Quota expiry must be in the future", undefined, {
          messageKey: "errors.expiryMustBeFuture",
        });
      const values = {
        dailyFreeQuota: body.dailyFreeQuota,
        expiresAt,
        status: 1,
        createdByUserId: guard.users.principal.subjectUserId,
      };
      const row = existing
        ? await tx.developerQuotaOverride.update({ where: { id: existing.id }, data: values })
        : await tx.developerQuotaOverride.create({
            data: { ...values, subjectType: body.subjectType, subjectId: body.subjectId, service: expected.service },
          });
      await guard.recheckEntry(row.id);
      await this.identity(tx, guard);
      await guard.recheckEntry(row.id);
      return row;
    });
  }
  async remove(target: DeveloperQuotaWriteTarget, guard: PlatformDeveloperQuotaWriteGuard) {
    if (!isDeveloperQuotaRecordId(target.id)) throw iamAccountDenied();
    return this.transaction(async (tx) => {
      await this.identity(tx, guard);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM developer_quota_overrides WHERE id = ${target.id} FOR UPDATE`);
      const row = await tx.developerQuotaOverride.findUnique({ where: { id: target.id } });
      this.same(row, target);
      if (!row || row.status !== 1) throw iamAccountDenied();
      await guard.recheckEntry(row.id);
      await tx.developerQuotaOverride.update({ where: { id: row.id }, data: { status: -1 } });
      await this.identity(tx, guard);
      await guard.recheckEntry(row.id);
      return row;
    });
  }
}
