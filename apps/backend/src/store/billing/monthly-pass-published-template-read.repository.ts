import type { IamPrincipal } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { monthlyPassTemplateArn } from "@/iam/resources/monthly-pass-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import { readIamPersonalCollection } from "../users/iam-personal-collection-read";
import {
  MONTHLY_PASS_PUBLISHED_TEMPLATE_SELECT,
  type MonthlyPassPublishedTemplate,
  type MonthlyPassPublishedTemplateReadStore,
} from "./monthly-pass-published-template-read.store";
export class MonthlyPassPublishedTemplateReadRepository implements MonthlyPassPublishedTemplateReadStore {
  private static instance: MonthlyPassPublishedTemplateReadRepository;
  static getInstance() {
    return (this.instance ??= new MonthlyPassPublishedTemplateReadRepository());
  }
  async list(
    principal: IamPrincipal,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
  ) {
    const limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
    return readIamPersonalCollection(principal, decide, recheck, async (tx, checkedDecide) => {
      const selected: { id: string; publishedAt: Date | null; updateTime: Date }[] = [];
      let after: string | undefined;
      for (;;) {
        const rows = await tx.monthlyPassTemplate.findMany({
          where: { status: 1, publishStatus: "published", ...(after ? { id: { gt: after } } : {}) },
          orderBy: { id: "asc" },
          take: limit,
          select: { id: true, publishedAt: true, updateTime: true },
        });
        if (!rows.length) break;
        const outcomes = await checkedDecide(
          rows.map((row) => monthlyPassTemplateArn(principal.accountOwnerId, principal.subjectUserId, row.id)),
        );
        rows.forEach((row, index) => {
          if (outcomes[index] === "Allow") selected.push(row);
        });
        after = rows[rows.length - 1]!.id;
        if (rows.length < limit) break;
      }
      selected.sort(
        (a, b) =>
          (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0) ||
          b.updateTime.getTime() - a.updateTime.getTime() ||
          a.id.localeCompare(b.id),
      );
      const result: MonthlyPassPublishedTemplate[] = [];
      for (let offset = 0; offset < selected.length; offset += limit) {
        const batch = selected.slice(offset, offset + limit);
        const records = await tx.monthlyPassTemplate.findMany({
          where: { id: { in: batch.map((row) => row.id) }, status: 1, publishStatus: "published" },
          select: MONTHLY_PASS_PUBLISHED_TEMPLATE_SELECT,
        });
        const byId = new Map(records.map((row) => [row.id, row]));
        for (const target of batch) {
          const row = byId.get(target.id);
          if (
            !row ||
            row.updateTime.getTime() !== target.updateTime.getTime() ||
            row.publishedAt?.getTime() !== target.publishedAt?.getTime()
          )
            throw iamAccountDenied();
          result.push(row);
        }
      }
      return result;
    });
  }
}
