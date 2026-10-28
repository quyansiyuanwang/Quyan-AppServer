import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { platformScalarColumns } from "../system/platform-scalar-revision";
import type { PlatformCollectionCursor } from "../system/platform-collection.store";
import type {
  MonthlyPassUsageFilters,
  MonthlyPassUsageReadTarget,
  PlatformMonthlyPassUsageReadStore,
} from "./platform-monthly-pass-usage-read.store";
export function validMonthlyPassUsageReadTarget(row: MonthlyPassUsageReadTarget) {
  return (
    !!row &&
    [row.id, row.userId, row.passId, row.templateId].every(isPlatformLogResourceId) &&
    row.status === 1 &&
    /^[a-f0-9]{64}$/.test(row.revision) &&
    [row.createTime, row.updateTime].every((date) => date instanceof Date && Number.isFinite(date.getTime()))
  );
}
/** Scan identifiers and revisions; hydrate usage content only for the authorized page. */
export class PlatformMonthlyPassUsageReadRepository implements PlatformMonthlyPassUsageReadStore {
  private static instance: PlatformMonthlyPassUsageReadRepository;
  static getInstance() {
    return (this.instance ??= new PlatformMonthlyPassUsageReadRepository());
  }
  async where(filters: MonthlyPassUsageFilters) {
    if (
      [filters.userId, filters.templateId].some((id) => id !== undefined && !isPlatformLogResourceId(id)) ||
      (filters.model !== undefined &&
        (typeof filters.model !== "string" ||
          !filters.model ||
          filters.model.length > 512 ||
          [...filters.model].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))) ||
      [filters.startAt, filters.endAt].some(
        (date) => date !== undefined && (!(date instanceof Date) || !Number.isFinite(date.getTime())),
      ) ||
      (filters.startAt && filters.endAt && filters.startAt > filters.endAt)
    )
      throw iamAccountDenied();
    return { ...filters };
  }
  async scan(filters: MonthlyPassUsageFilters, after?: PlatformCollectionCursor, boundary?: PlatformCollectionCursor) {
    for (const cursor of [after, boundary])
      if (
        cursor &&
        (!isPlatformLogResourceId(cursor.id) ||
          !(cursor.createTime instanceof Date) ||
          !Number.isFinite(cursor.createTime.getTime()))
      )
        throw iamAccountDenied();
    const columns = [
      ...platformScalarColumns("MonthlyPassUsage", "u"),
      ...platformScalarColumns("UserMonthlyPass", "p", ["id", "userId", "templateId", "status", "updateTime"]),
      ...platformScalarColumns("MonthlyPassTemplate", "t", ["id", "name", "status", "updateTime"]),
    ];
    return prisma.$queryRaw<MonthlyPassUsageReadTarget[]>(Prisma.sql`
      SELECT u.id,u.userId,u.userMonthlyPassId AS passId,p.templateId,u.status,u.createTime,u.updateTime,
        SHA2(CAST(JSON_ARRAY(${Prisma.join(columns)}) AS CHAR),256) AS revision
      FROM monthly_pass_usages u JOIN user_monthly_passes p ON BINARY p.id=BINARY u.userMonthlyPassId AND BINARY p.userId=BINARY u.userId
      JOIN monthly_pass_templates t ON BINARY t.id=BINARY p.templateId
      WHERE u.status=1
      ${filters.userId ? Prisma.sql`AND BINARY u.userId=BINARY ${filters.userId}` : Prisma.empty}
      ${filters.templateId ? Prisma.sql`AND BINARY p.templateId=BINARY ${filters.templateId}` : Prisma.empty}
      ${filters.model ? Prisma.sql`AND BINARY u.model=BINARY ${filters.model}` : Prisma.empty}
      ${filters.startAt ? Prisma.sql`AND u.createTime>=${filters.startAt}` : Prisma.empty}
      ${filters.endAt ? Prisma.sql`AND u.createTime<=${filters.endAt}` : Prisma.empty}
      ${after ? Prisma.sql`AND (u.createTime<${after.createTime} OR (u.createTime=${after.createTime} AND u.id<${after.id}))` : Prisma.empty}
      ${boundary ? Prisma.sql`AND (u.createTime<${boundary.createTime} OR (u.createTime=${boundary.createTime} AND u.id<=${boundary.id}))` : Prisma.empty}
      ORDER BY u.createTime DESC,u.id DESC LIMIT ${IAM_AUTHORIZATION_LIMITS.resourcesPerRequest}`);
  }
  async hydrate(
    principal: IamPrincipal,
    page: readonly { target: MonthlyPassUsageReadTarget; templateName: boolean }[],
  ) {
    if (!page.length) return [];
    if (
      page.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(page.map((row) => row.target.id)).size !== page.length ||
      page.some((row) => !validMonthlyPassUsageReadTarget(row.target) || typeof row.templateName !== "boolean")
    )
      throw iamAccountDenied();
    return prisma.$transaction(async (tx) => {
      await platformManagementGroupSnapshot(principal, Permission.MONTHLY_PASS_USAGE_READ, tx);
      const records = await tx.monthlyPassUsage.findMany({
        where: { id: { in: page.map((row) => row.target.id) }, status: 1 },
      });
      const ids = [...new Set(page.filter((row) => row.templateName).map((row) => row.target.templateId))];
      const templates = ids.length
        ? await tx.monthlyPassTemplate.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        : [];
      return page.map(({ target, templateName }) => {
        const record = records.find((row) => row.id === target.id);
        const template = templateName ? templates.find((row) => row.id === target.templateId) : undefined;
        if (
          !record ||
          record.userId !== target.userId ||
          record.userMonthlyPassId !== target.passId ||
          (templateName && !template)
        )
          throw iamAccountDenied();
        return { record, templateId: target.templateId, ...(templateName ? { templateName: template!.name } : {}) };
      });
    });
  }
}
