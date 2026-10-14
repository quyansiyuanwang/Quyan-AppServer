import { Prisma } from "@prisma/client";
import { buildAcsResource, type IamPrincipal } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import {
  remoteTerminalProductEntitlementArn,
  remoteTerminalProductBindingArn,
  remoteTerminalProductRegistrationTokenArn,
} from "@/iam/resources/remote-terminal-resources";
import { activeIamAccountUsers, iamAccountDenied } from "../users/iam-account-principal";
import { readPersonalTerminalCollection } from "./terminal-personal-read-transaction";
import {
  PLATFORM_TERMINAL_DEVICE_PUBLIC_SELECT,
  type TerminalDeviceReadView,
} from "./platform-terminal-device-read.store";
import type { TerminalPersonalDeviceReadStore } from "./terminal-personal-device-read.store";
export class TerminalPersonalDeviceReadRepository implements TerminalPersonalDeviceReadStore {
  private static instance: TerminalPersonalDeviceReadRepository;
  static getInstance() {
    return (this.instance ??= new TerminalPersonalDeviceReadRepository());
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
      const selected: { id: string; registeredAt: Date; updateTime: Date }[] = [];
      let after: string | undefined;
      for (;;) {
        const rows = await tx.remoteTerminalDeviceBinding.findMany({
          where: { userId, status: status ?? { gte: 0 }, ...(after ? { id: { gt: after } } : {}) },
          orderBy: { id: "asc" },
          take: limit,
          select: { id: true, userId: true, registeredAt: true, updateTime: true },
        });
        if (!rows.length) break;
        const outcomes = await checkedDecide(rows.map((row) => remoteTerminalProductBindingArn(owner, userId, row.id)));
        rows.forEach((row, index) => {
          if (outcomes[index] === "Allow") selected.push(row);
        });
        after = rows[rows.length - 1]!.id;
        if (rows.length < limit) break;
      }
      selected.sort(
        (a, b) =>
          b.registeredAt.getTime() - a.registeredAt.getTime() ||
          b.updateTime.getTime() - a.updateTime.getTime() ||
          a.id.localeCompare(b.id),
      );
      const page = selected.slice((pagination.page - 1) * pagination.pageSize, pagination.page * pagination.pageSize),
        records: TerminalDeviceReadView[] = [];
      for (const source of page) {
        const record = await tx.remoteTerminalDeviceBinding.findFirst({
          where: { id: source.id, userId, status: status ?? { gte: 0 } },
          select: PLATFORM_TERMINAL_DEVICE_PUBLIC_SELECT,
        });
        if (
          !record ||
          record.registeredAt.getTime() !== source.registeredAt.getTime() ||
          record.updateTime.getTime() !== source.updateTime.getTime()
        )
          throw iamAccountDenied();
        const parent = await tx.remoteTerminalUserEntitlement.findUnique({
          where: { id: record.entitlementId },
          select: { userId: true },
        });
        if (!parent || parent.userId !== userId) throw iamAccountDenied();
        // Project only supported shell metadata; never read the heartbeat token or complete host snapshot.
        const shells = await tx.$queryRaw<{ id: string; availableShells: unknown }[]>(
          Prisma.sql`SELECT id,JSON_EXTRACT(snapshot,'$.diagnostics.availableShells') AS availableShells FROM remote_terminal_device_bindings WHERE id=${record.id} AND userId=${userId}`,
        );
        if (shells.length !== 1 || shells[0]!.id !== record.id) throw iamAccountDenied();
        const view: TerminalDeviceReadView = { record: { ...record }, availableShells: shells[0]!.availableShells };
        const userArn = buildAcsResource({ service: "quyan", region: "*", accountId: owner, path: "user/" + userId });
        if ((await checkedDecide([userArn]))[0] === "Allow")
          view.username = (
            await tx.user.findFirst({
              where: { ...activeIamAccountUsers(owner), id: userId },
              select: { username: true },
            })
          )?.username;
        if (
          (await checkedDecide([remoteTerminalProductEntitlementArn(owner, userId, record.entitlementId)]))[0] ===
          "Allow"
        )
          view.entitlementName = (
            await tx.remoteTerminalUserEntitlement.findUnique({
              where: { id: record.entitlementId },
              select: { name: true },
            })
          )?.name;
        if (record.registrationTokenId) {
          const token = await tx.remoteTerminalEntitlementToken.findUnique({
            where: { id: record.registrationTokenId },
            select: { entitlementId: true },
          });
          if (!token || token.entitlementId !== record.entitlementId) throw iamAccountDenied();
        }
        if (
          record.registrationTokenId &&
          (
            await checkedDecide([
              remoteTerminalProductRegistrationTokenArn(
                owner,
                userId,
                record.entitlementId,
                record.registrationTokenId,
              ),
            ])
          )[0] !== "Allow"
        )
          view.record.registrationTokenId = null;
        records.push(view);
      }
      return { total: selected.length, records };
    });
  }
}
