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
  MonthlyPassAssignmentFilters,
  MonthlyPassAssignmentReadTarget,
  MonthlyPassAssignmentProjection,
  PlatformMonthlyPassAssignmentReadStore,
} from "./platform-monthly-pass-assignment-read.store";
export function validMonthlyPassAssignmentReadTarget(row: MonthlyPassAssignmentReadTarget) {
  return (
    !!row &&
    [row.id, row.userId, row.templateId].every(isPlatformLogResourceId) &&
    [-1, 0, 1].includes(row.status) &&
    /^[a-f0-9]{64}$/.test(row.revision) &&
    Number.isSafeInteger(row.displayOrder) &&
    row.displayOrder > 0 &&
    [row.createTime, row.updateTime].every((date) => date instanceof Date && Number.isFinite(date.getTime()))
  );
}
export class PlatformMonthlyPassAssignmentReadRepository implements PlatformMonthlyPassAssignmentReadStore {
  private static instance: PlatformMonthlyPassAssignmentReadRepository;
  static getInstance() {
    return (this.instance ??= new PlatformMonthlyPassAssignmentReadRepository());
  }
  async where(filters: MonthlyPassAssignmentFilters) {
    if (
      [filters.userId, filters.templateId].some((id) => id !== undefined && !isPlatformLogResourceId(id)) ||
      (filters.status !== undefined && ![-1, 0, 1].includes(filters.status))
    )
      throw iamAccountDenied();
    return { ...filters };
  }
  private revision() {
    const columns = [
      ...platformScalarColumns("UserMonthlyPass", "p"),
      ...platformScalarColumns("MonthlyPassTemplate", "t", [
        "id",
        "name",
        "description",
        "allowedModels",
        "allowedChannels",
        "status",
        "updateTime",
      ]),
      ...platformScalarColumns("User", "u", ["id", "username", "status", "updateTime"]),
    ];
    columns.push(
      Prisma.sql`COALESCE((SELECT CAST(JSON_ARRAYAGG(JSON_ARRAY(${Prisma.join(platformScalarColumns("UserMonthlyPassQuotaWindow", "q"))})) OVER (ORDER BY q.id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS CHAR) FROM user_monthly_pass_quota_windows q WHERE BINARY q.userMonthlyPassId=BINARY p.id LIMIT 1),'[]')`,
      Prisma.sql`COALESCE((SELECT CAST(JSON_ARRAYAGG(JSON_ARRAY(${Prisma.join(platformScalarColumns("MonthlyPassUsage", "s"))})) OVER (ORDER BY s.id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS CHAR) FROM monthly_pass_usages s WHERE BINARY s.userMonthlyPassId=BINARY p.id AND s.status=1 LIMIT 1),'[]')`,
    );
    return Prisma.sql`SHA2(CAST(JSON_ARRAY(${Prisma.join(columns)}) AS CHAR),256)`;
  }
  async scan(
    filters: MonthlyPassAssignmentFilters,
    after?: PlatformCollectionCursor,
    boundary?: PlatformCollectionCursor,
  ) {
    for (const cursor of [after, boundary])
      if (
        cursor &&
        (!isPlatformLogResourceId(cursor.id) ||
          !(cursor.createTime instanceof Date) ||
          !Number.isFinite(cursor.createTime.getTime()))
      )
        throw iamAccountDenied();
    const rows = await prisma.$queryRaw<
      (Omit<MonthlyPassAssignmentReadTarget, "displayOrder"> & { displayOrder: bigint })[]
    >(Prisma.sql`
   SELECT * FROM (SELECT p.id,p.userId,p.templateId,p.status,p.createTime,p.updateTime,${this.revision()} AS revision,
    ROW_NUMBER() OVER(ORDER BY p.endAt ASC,p.createTime DESC,p.id DESC) AS displayOrder
    FROM user_monthly_passes p JOIN monthly_pass_templates t ON BINARY t.id=BINARY p.templateId JOIN users u ON BINARY u.id=BINARY p.userId
    WHERE p.status ${filters.status === undefined ? Prisma.sql`>=0` : Prisma.sql`=${filters.status}`}
    ${filters.userId ? Prisma.sql`AND BINARY p.userId=BINARY ${filters.userId}` : Prisma.empty}
    ${filters.templateId ? Prisma.sql`AND BINARY p.templateId=BINARY ${filters.templateId}` : Prisma.empty}
   ) metadata WHERE 1=1
   ${after ? Prisma.sql`AND (createTime<${after.createTime} OR (createTime=${after.createTime} AND id<${after.id}))` : Prisma.empty}
   ${boundary ? Prisma.sql`AND (createTime<${boundary.createTime} OR (createTime=${boundary.createTime} AND id<=${boundary.id}))` : Prisma.empty}
   ORDER BY createTime DESC,id DESC LIMIT ${IAM_AUTHORIZATION_LIMITS.resourcesPerRequest}`);
    const result = rows.map((row) => ({ ...row, displayOrder: Number(row.displayOrder) }));
    if (result.some((row) => !validMonthlyPassAssignmentReadTarget(row))) throw iamAccountDenied();
    return result;
  }
  async scanUsages(target: MonthlyPassAssignmentReadTarget, after?: string) {
    if (!validMonthlyPassAssignmentReadTarget(target) || (after !== undefined && !isPlatformLogResourceId(after)))
      throw iamAccountDenied();
    return prisma.monthlyPassUsage.findMany({
      where: { userMonthlyPassId: target.id, status: 1, ...(after ? { id: { gt: after } } : {}) },
      select: { id: true, userId: true, userMonthlyPassId: true, status: true },
      orderBy: { id: "asc" },
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  async hydrate(
    principal: IamPrincipal,
    page: readonly { target: MonthlyPassAssignmentReadTarget; projection: MonthlyPassAssignmentProjection }[],
  ) {
    if (!page.length) return [];
    if (
      page.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(page.map((row) => row.target.id)).size !== page.length ||
      page.some(
        (row) =>
          !validMonthlyPassAssignmentReadTarget(row.target) ||
          !row.projection ||
          [row.projection.username, row.projection.template, row.projection.quotaUsage].some(
            (value) => typeof value !== "boolean",
          ),
      )
    )
      throw iamAccountDenied();
    return prisma.$transaction(async (tx) => {
      await platformManagementGroupSnapshot(principal, Permission.MONTHLY_PASS_ASSIGNMENT_READ, tx);
      const records = await tx.userMonthlyPass.findMany({
        where: { id: { in: page.map((row) => row.target.id) } },
        include: { quotaWindows: { orderBy: [{ quotaWindowHours: "asc" }, { createTime: "asc" }] } },
      });
      const templateIds = [
          ...new Set(page.filter((row) => row.projection.template).map((row) => row.target.templateId)),
        ],
        userIds = [...new Set(page.filter((row) => row.projection.username).map((row) => row.target.userId))];
      const templates = templateIds.length
        ? await tx.monthlyPassTemplate.findMany({
            where: { id: { in: templateIds } },
            select: { id: true, name: true, description: true, allowedModels: true, allowedChannels: true },
          })
        : [];
      const users = userIds.length
        ? await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } })
        : [];
      return page.map(({ target, projection }) => {
        const record = records.find((row) => row.id === target.id),
          template = templates.find((row) => row.id === target.templateId),
          user = users.find((row) => row.id === target.userId);
        if (
          !record ||
          record.userId !== target.userId ||
          record.templateId !== target.templateId ||
          record.status !== target.status ||
          (projection.template && !template) ||
          (projection.username && !user)
        )
          throw iamAccountDenied();
        return {
          record: {
            ...record,
            template: projection.template
              ? {
                  name: template!.name,
                  description: template!.description,
                  allowedModels: template!.allowedModels,
                  allowedChannels: template!.allowedChannels,
                }
              : { name: "", description: null, allowedModels: null, allowedChannels: null },
            user: { username: projection.username ? user!.username : "" },
          },
          quotaUsage: projection.quotaUsage,
        };
      });
    });
  }
}
