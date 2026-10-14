import { buildAcsResource, type IamPrincipal } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import {
  monthlyPassAssignmentArn,
  monthlyPassTemplateArn,
  monthlyPassUsageArn,
} from "@/iam/resources/monthly-pass-resources";
import { readIamPersonalCollection } from "../users/iam-personal-collection-read";
import { activeIamAccountUsers, iamAccountDenied } from "../users/iam-account-principal";
import { getUserMonthlyPassQuotaWindows } from "@/util/monthly-pass-quota-windows";
import { summarizeMonthlyPassWindowUsage } from "./monthly-pass-usage-summary";
import type { MonthlyPassPersonalReadStore, MonthlyPassPersonalReadView } from "./monthly-pass-personal-read.store";
export class MonthlyPassPersonalReadRepository implements MonthlyPassPersonalReadStore {
  private static instance: MonthlyPassPersonalReadRepository;
  static getInstance() {
    return (this.instance ??= new MonthlyPassPersonalReadRepository());
  }
  async list(
    principal: IamPrincipal,
    pagination: { page: number; pageSize: number },
    status: number | undefined,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
  ) {
    if (
      (status !== undefined && ![-1, 0, 1].includes(status)) ||
      !Number.isSafeInteger(pagination.page) ||
      pagination.page < 1 ||
      !Number.isSafeInteger(pagination.pageSize) ||
      pagination.pageSize < 1 ||
      pagination.pageSize > 100 ||
      !Number.isSafeInteger(pagination.page * pagination.pageSize)
    )
      throw iamAccountDenied();
    const userId = principal.subjectUserId,
      owner = principal.accountOwnerId,
      limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
    return readIamPersonalCollection(principal, decide, recheck, async (tx, checkedDecide) => {
      const selected: { id: string; endAt: Date; createTime: Date }[] = [];
      let after: string | undefined;
      for (;;) {
        const rows = await tx.userMonthlyPass.findMany({
          where: { userId, status: status ?? { gte: 0 }, ...(after ? { id: { gt: after } } : {}) },
          orderBy: { id: "asc" },
          take: limit,
          select: { id: true, userId: true, endAt: true, createTime: true },
        });
        if (!rows.length) break;
        if (rows.some((row) => row.userId !== userId)) throw iamAccountDenied();
        const outcomes = await checkedDecide(rows.map((row) => monthlyPassAssignmentArn(owner, userId, row.id)));
        rows.forEach((row, index) => {
          if (outcomes[index] === "Allow") selected.push(row);
        });
        after = rows[rows.length - 1]!.id;
        if (rows.length < limit) break;
      }
      selected.sort(
        (a, b) =>
          a.endAt.getTime() - b.endAt.getTime() ||
          b.createTime.getTime() - a.createTime.getTime() ||
          b.id.localeCompare(a.id),
      );
      const page = selected.slice((pagination.page - 1) * pagination.pageSize, pagination.page * pagination.pageSize),
        records: MonthlyPassPersonalReadView[] = [];
      for (const target of page) {
        const record = await tx.userMonthlyPass.findFirst({
          where: { id: target.id, userId, status: status ?? { gte: 0 } },
          include: { quotaWindows: { orderBy: [{ quotaWindowHours: "asc" }, { createTime: "asc" }] } },
        });
        if (
          !record ||
          record.id !== target.id ||
          record.userId !== userId ||
          record.endAt.getTime() !== target.endAt.getTime() ||
          record.createTime.getTime() !== target.createTime.getTime()
        )
          throw iamAccountDenied();
        const [userDecision, templateDecision] = await checkedDecide([
          buildAcsResource({ service: "quyan", region: "*", accountId: owner, path: "user/" + userId }),
          monthlyPassTemplateArn(owner, userId, record.templateId),
        ]);
        const user =
          userDecision === "Allow"
            ? await tx.user.findFirst({
                where: { ...activeIamAccountUsers(owner), id: userId },
                select: { id: true, username: true },
              })
            : undefined;
        const template =
          templateDecision === "Allow"
            ? await tx.monthlyPassTemplate.findUnique({
                where: { id: record.templateId },
                select: { id: true, name: true, description: true, allowedModels: true, allowedChannels: true },
              })
            : undefined;
        if (
          (userDecision === "Allow" && user?.id !== userId) ||
          (templateDecision === "Allow" && template?.id !== record.templateId)
        )
          throw iamAccountDenied();
        const view: MonthlyPassPersonalReadView = {
          record: {
            ...record,
            user: { username: user?.username ?? "" },
            template: template
              ? {
                  name: template.name,
                  description: template.description,
                  allowedModels: template.allowedModels,
                  allowedChannels: template.allowedChannels,
                }
              : { name: "", description: null, allowedModels: null, allowedChannels: null },
          },
        };
        let usageAfter: string | undefined,
          complete = true;
        for (;;) {
          const usages = await tx.monthlyPassUsage.findMany({
            where: { userMonthlyPassId: record.id, status: 1, ...(usageAfter ? { id: { gt: usageAfter } } : {}) },
            orderBy: { id: "asc" },
            take: limit,
            select: { id: true, userId: true, userMonthlyPassId: true },
          });
          if (!usages.length) break;
          if (usages.some((row) => row.userId !== userId || row.userMonthlyPassId !== record.id))
            throw iamAccountDenied();
          const outcomes = await checkedDecide(
            usages.map((row) => monthlyPassUsageArn(owner, userId, record.id, row.id)),
          );
          complete &&= outcomes.every((value) => value === "Allow");
          usageAfter = usages[usages.length - 1]!.id;
          if (usages.length < limit) break;
        }
        if (complete)
          view.usageSummary = await summarizeMonthlyPassWindowUsage(
            tx,
            getUserMonthlyPassQuotaWindows(record).map((window) => ({
              passId: record.id,
              quotaUnit: window.quotaUnit,
              quotaWindowHours: window.quotaWindowHours,
            })),
            new Date(),
          );
        records.push(view);
      }
      return { total: selected.length, records };
    });
  }
}
