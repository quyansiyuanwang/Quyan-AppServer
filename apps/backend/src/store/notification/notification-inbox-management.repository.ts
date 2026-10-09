import { Prisma } from "@prisma/client";
import { MANAGED_STATUS, type IamPrincipal } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { ConflictError } from "@/util/errors";
import { notificationAccountTransaction, notificationAuthorizationDenied } from "./notification-account-guard";

const targetSelect = {
  id: true,
  userId: true,
  status: true,
  isRead: true,
  pixelOpened: true,
  createTime: true,
  updateTime: true,
} satisfies Prisma.NotificationInboxItemSelect;
export type NotificationInboxTarget = Prisma.NotificationInboxItemGetPayload<{ select: typeof targetSelect }>;
const changed = () =>
  new ConflictError("Inbox resource changed after authorization", undefined, { messageKey: "errors.conflict" });
function sameTarget(current: NotificationInboxTarget | undefined, expected: NotificationInboxTarget): boolean {
  return Boolean(
    current &&
      current.id === expected.id &&
      current.userId === expected.userId &&
      current.status === MANAGED_STATUS.ENABLED &&
      current.isRead === expected.isRead &&
      current.pixelOpened === expected.pixelOpened &&
      current.createTime.getTime() === expected.createTime.getTime() &&
      current.updateTime.getTime() === expected.updateTime.getTime(),
  );
}
/** Request-only storage. Scans carry no message content; hydration and writes recheck exact authorized snapshots. */
export class NotificationInboxManagementRepository {
  private static instance: NotificationInboxManagementRepository;
  static getInstance() {
    return (this.instance ??= new NotificationInboxManagementRepository());
  }
  async scan(principal: IamPrincipal, after?: NotificationInboxTarget, unreadOnly = false, pixelOnly = false) {
    return notificationAccountTransaction(principal, (tx) =>
      tx.notificationInboxItem.findMany({
        where: {
          userId: principal.subjectUserId,
          status: MANAGED_STATUS.ENABLED,
          ...(unreadOnly ? { isRead: false } : {}),
          ...(pixelOnly ? { pixelOpened: true } : {}),
          ...(after
            ? {
                OR: [
                  ...(!after.isRead ? [{ isRead: true }] : []),
                  { isRead: after.isRead, createTime: { lt: after.createTime } },
                  { isRead: after.isRead, createTime: after.createTime, id: { lt: after.id } },
                ],
              }
            : {}),
        },
        select: targetSelect,
        orderBy: [{ isRead: "asc" }, { createTime: "desc" }, { id: "desc" }],
        take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
      }),
    );
  }
  async selected(principal: IamPrincipal, ids: readonly string[]) {
    return notificationAccountTransaction(principal, async (tx) => {
      const rows = await tx.notificationInboxItem.findMany({
        where: { id: { in: [...ids] }, userId: principal.subjectUserId, status: MANAGED_STATUS.ENABLED },
        select: targetSelect,
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      if (ids.some((id) => !byId.has(id))) throw notificationAuthorizationDenied();
      return ids.map((id) => byId.get(id)!);
    });
  }
  private async current(
    tx: Prisma.TransactionClient,
    principal: IamPrincipal,
    expected: readonly NotificationInboxTarget[],
  ) {
    if (expected.some((row) => row.userId !== principal.subjectUserId)) throw notificationAuthorizationDenied();
    const rows = await tx.notificationInboxItem.findMany({
      where: {
        id: { in: expected.map((row) => row.id) },
        userId: principal.subjectUserId,
        status: MANAGED_STATUS.ENABLED,
      },
      select: targetSelect,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return expected.map((row) => {
      const current = byId.get(row.id);
      if (!current) throw notificationAuthorizationDenied();
      if (!sameTarget(current, row)) throw changed();
      return current;
    });
  }
  async validate(principal: IamPrincipal, expected: readonly NotificationInboxTarget[]) {
    return notificationAccountTransaction(principal, (tx) => this.current(tx, principal, expected));
  }
  async hydrate(principal: IamPrincipal, expected: readonly NotificationInboxTarget[]) {
    return notificationAccountTransaction(principal, async (tx) => {
      await this.current(tx, principal, expected);
      const rows = await tx.notificationInboxItem.findMany({
        where: {
          id: { in: expected.map((row) => row.id) },
          userId: principal.subjectUserId,
          status: MANAGED_STATUS.ENABLED,
        },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      return expected.map((row) => byId.get(row.id)!);
    });
  }
  async markRead(principal: IamPrincipal, expected: readonly NotificationInboxTarget[], source: "manual" | "pixel") {
    return notificationAccountTransaction(principal, async (tx) => {
      const batches: NotificationInboxTarget[][] = [];
      for (let offset = 0; offset < expected.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest)
        batches.push(expected.slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest));
      // Recheck every selected target before the first write. Never re-query a broader markAll predicate.
      for (const batch of batches) await this.current(tx, principal, batch);
      let count = 0;
      const readTime = new Date();
      for (const batch of batches) {
        const unread = batch.filter((row) => !row.isRead);
        if (!unread.length) continue;
        const result = await tx.notificationInboxItem.updateMany({
          where: {
            id: { in: unread.map((row) => row.id) },
            userId: principal.subjectUserId,
            status: MANAGED_STATUS.ENABLED,
            isRead: false,
            ...(source === "pixel" ? { pixelOpened: true } : {}),
          },
          data: { isRead: true, readTime, readSource: source },
        });
        if (result.count !== unread.length) throw changed();
        count += result.count;
      }
      return count;
    });
  }
}
