import { buildAcsResource, type IamPrincipal } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import {
  remoteTerminalProductEntitlementArn,
  remoteTerminalProductBindingArn,
  remoteTerminalProductRegistrationTokenArn,
  remoteTerminalPublishedTemplateArn,
} from "@/iam/resources/remote-terminal-resources";
import { activeIamAccountUsers, iamAccountDenied } from "../users/iam-account-principal";
import { readPersonalTerminalCollection } from "./terminal-personal-read-transaction";
import { TERMINAL_REGISTRATION_METADATA_SELECT } from "./terminal-registration-rotation.repository";
import type { TerminalPersonalEntitlementReadStore } from "./terminal-personal-entitlement-read.store";
import type { TerminalEntitlementReadView } from "./platform-terminal-entitlement-read.store";
export class TerminalPersonalEntitlementReadRepository implements TerminalPersonalEntitlementReadStore {
  private static instance: TerminalPersonalEntitlementReadRepository;
  static getInstance() {
    return (this.instance ??= new TerminalPersonalEntitlementReadRepository());
  }
  async list(
    principal: IamPrincipal,
    pagination: { page: number; pageSize: number },
    status: number | undefined,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
  ) {
    if (status !== undefined && ![-1, 0, 1].includes(status)) throw iamAccountDenied();
    if (
      ![pagination.page, pagination.pageSize].every(Number.isSafeInteger) ||
      pagination.page < 1 ||
      pagination.pageSize < 1 ||
      pagination.pageSize > 100 ||
      !Number.isSafeInteger(pagination.page * pagination.pageSize)
    )
      throw iamAccountDenied();
    const userId = principal.subjectUserId,
      owner = principal.accountOwnerId,
      limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
    return readPersonalTerminalCollection(principal, decide, recheck, async (tx, checkedDecide) => {
      const selected: { id: string; endAt: Date; updateTime: Date }[] = [];
      let after: string | undefined;
      for (;;) {
        const rows = await tx.remoteTerminalUserEntitlement.findMany({
          where: { userId, status: status ?? { gte: 0 }, ...(after ? { id: { gt: after } } : {}) },
          orderBy: { id: "asc" },
          take: limit,
          select: { id: true, userId: true, endAt: true, updateTime: true },
        });
        if (!rows.length) break;
        const outcomes = await checkedDecide(
          rows.map((row) => remoteTerminalProductEntitlementArn(owner, userId, row.id)),
        );
        if (outcomes.length !== rows.length || rows.some((row) => row.userId !== userId)) throw iamAccountDenied();
        rows.forEach((row, index) => {
          if (outcomes[index] === "Allow") selected.push(row);
        });
        after = rows[rows.length - 1]!.id;
        if (rows.length < limit) break;
      }
      selected.sort(
        (a, b) =>
          a.endAt.getTime() - b.endAt.getTime() ||
          b.updateTime.getTime() - a.updateTime.getTime() ||
          a.id.localeCompare(b.id),
      );
      const page = selected.slice((pagination.page - 1) * pagination.pageSize, pagination.page * pagination.pageSize),
        records: TerminalEntitlementReadView[] = [];
      for (const source of page) {
        const record = await tx.remoteTerminalUserEntitlement.findFirst({
          where: { id: source.id, userId, status: status ?? { gte: 0 } },
        });
        if (
          !record ||
          record.endAt.getTime() !== source.endAt.getTime() ||
          record.updateTime.getTime() !== source.updateTime.getTime()
        )
          throw iamAccountDenied();
        const view: TerminalEntitlementReadView = { record };
        // Each optional relationship is authorized before it is hydrated; no registration secret is selected.
        const userArn = (id: string) =>
          buildAcsResource({ service: "quyan", region: "*", accountId: owner, path: "user/" + id });
        if ((await checkedDecide([userArn(userId)]))[0] === "Allow")
          view.username = (
            await tx.user.findFirst({
              where: { ...activeIamAccountUsers(owner), id: userId },
              select: { username: true },
            })
          )?.username;
        if (record.assignedBy && (await checkedDecide([userArn(record.assignedBy)]))[0] === "Allow")
          view.assignedByUsername = (
            await tx.user.findFirst({
              where: { ...activeIamAccountUsers(owner), id: record.assignedBy },
              select: { username: true },
            })
          )?.username;
        if (
          record.templateId &&
          (await checkedDecide([remoteTerminalPublishedTemplateArn(owner, userId, record.templateId)]))[0] === "Allow"
        )
          view.templateName = (
            await tx.remoteTerminalProductTemplate.findFirst({
              where: { id: record.templateId, status: 1, publishStatus: "published" },
              select: { name: true },
            })
          )?.name;
        const token = await tx.remoteTerminalEntitlementToken.findFirst({
          where: { entitlementId: record.id, status: { gte: 0 } },
          select: { id: true },
        });
        if (
          token &&
          (await checkedDecide([remoteTerminalProductRegistrationTokenArn(owner, userId, record.id, token.id)]))[0] ===
            "Allow"
        )
          view.registrationToken =
            (await tx.remoteTerminalEntitlementToken.findUnique({
              where: { id: token.id },
              select: TERMINAL_REGISTRATION_METADATA_SELECT,
            })) ?? undefined;
        let deviceAfter: string | undefined,
          deviceCount = 0,
          complete = true;
        for (;;) {
          const devices = await tx.remoteTerminalDeviceBinding.findMany({
            where: {
              entitlementId: record.id,
              status: { gte: 0 },
              ...(deviceAfter ? { id: { gt: deviceAfter } } : {}),
            },
            orderBy: { id: "asc" },
            take: limit,
            select: { id: true, userId: true },
          });
          if (!devices.length) break;
          if (devices.some((row) => row.userId !== userId)) throw iamAccountDenied();
          const decisions = await decide(devices.map((row) => remoteTerminalProductBindingArn(owner, userId, row.id)));
          if (decisions.length !== devices.length) throw iamAccountDenied();
          complete &&= decisions.every((value) => value === "Allow");
          deviceCount += devices.length;
          deviceAfter = devices[devices.length - 1]!.id;
          if (devices.length < limit) break;
        }
        if (complete) view.registeredDeviceCount = deviceCount;
        records.push(view);
      }
      return { total: selected.length, records };
    });
  }
}
