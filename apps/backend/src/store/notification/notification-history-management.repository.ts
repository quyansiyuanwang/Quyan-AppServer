import { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { ConflictError } from "@/util/errors";
import { notificationAccountTransaction, notificationAuthorizationDenied } from "./notification-account-guard";

const targetSelect = {
  id: true,
  userId: true,
  createTime: true,
  eventType: true,
  channel: true,
  webhookId: true,
  deliveryStatus: true,
} satisfies Prisma.NotificationLogSelect;
export type NotificationDeliveryLogTarget = Prisma.NotificationLogGetPayload<{ select: typeof targetSelect }>;
function sameTarget(row: NotificationDeliveryLogTarget | undefined, expected: NotificationDeliveryLogTarget): boolean {
  return Boolean(
    row &&
      row.id === expected.id &&
      row.userId === expected.userId &&
      row.createTime.getTime() === expected.createTime.getTime() &&
      row.eventType === expected.eventType &&
      row.channel === expected.channel &&
      row.webhookId === expected.webhookId &&
      row.deliveryStatus === expected.deliveryStatus,
  );
}
/** Delivery logs have no lifecycle field or User relation: isolate by exact user and recheck the actor's account. */
export class NotificationHistoryManagementRepository {
  private static instance: NotificationHistoryManagementRepository;
  static getInstance() {
    return (this.instance ??= new NotificationHistoryManagementRepository());
  }
  async assertPrincipal(principal: IamPrincipal): Promise<void> {
    await notificationAccountTransaction(principal, async () => undefined);
  }
  async scan(principal: IamPrincipal, after?: NotificationDeliveryLogTarget) {
    return notificationAccountTransaction(principal, (tx) =>
      tx.notificationLog.findMany({
        where: {
          userId: principal.subjectUserId,
          ...(after
            ? { OR: [{ createTime: { lt: after.createTime } }, { createTime: after.createTime, id: { lt: after.id } }] }
            : {}),
        },
        select: targetSelect,
        orderBy: [{ createTime: "desc" }, { id: "desc" }],
        take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
      }),
    );
  }
  private async current(
    tx: Prisma.TransactionClient,
    principal: IamPrincipal,
    expected: readonly NotificationDeliveryLogTarget[],
  ) {
    if (expected.some((row) => row.userId !== principal.subjectUserId)) throw notificationAuthorizationDenied();
    const rows = await tx.notificationLog.findMany({
      where: { id: { in: expected.map((row) => row.id) }, userId: principal.subjectUserId },
      select: targetSelect,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return expected.map((row) => {
      const current = byId.get(row.id);
      if (!current) throw notificationAuthorizationDenied();
      if (!sameTarget(current, row))
        throw new ConflictError("Delivery log changed after authorization", undefined, {
          messageKey: "errors.conflict",
        });
      return current;
    });
  }
  async validate(principal: IamPrincipal, expected: readonly NotificationDeliveryLogTarget[]) {
    return notificationAccountTransaction(principal, (tx) => this.current(tx, principal, expected));
  }
  async hydrate(principal: IamPrincipal, expected: readonly NotificationDeliveryLogTarget[]) {
    return notificationAccountTransaction(principal, async (tx) => {
      await this.current(tx, principal, expected);
      // Metadata is not part of the public log contract. Never load it for list responses.
      const rows = await tx.notificationLog.findMany({
        where: { id: { in: expected.map((row) => row.id) }, userId: principal.subjectUserId },
        select: { ...targetSelect, title: true, content: true, errorMessage: true },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      return expected.map((row) => byId.get(row.id)!);
    });
  }
}
