import { Prisma, type NotificationWebhook } from "@prisma/client";
import { MANAGED_STATUS, type IamPrincipal } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { ConflictError, NotFoundError } from "@/util/errors";
import { notificationAccountTransaction, notificationAuthorizationDenied } from "./notification-account-guard";
import type {
  NotificationWebhookCreateInput,
  NotificationWebhookUpdateInput,
  NotificationPreferenceUpdateInput,
} from "./notification-preference.repository";
const targetSelect = {
  id: true,
  userId: true,
  preferenceId: true,
  status: true,
  createTime: true,
  updateTime: true,
  preference: { select: { id: true, userId: true, status: true, updateTime: true } },
} satisfies Prisma.NotificationWebhookSelect;
export type NotificationWebhookTarget = Prisma.NotificationWebhookGetPayload<{ select: typeof targetSelect }>;
export type NotificationWebhookView = Omit<NotificationWebhook, "secret"> & { hasSecret: boolean };
type PreferenceDefaults = Required<
  Pick<NotificationPreferenceUpdateInput, "subscribedEvents" | "knownEvents" | "thresholds" | "cooldownMinutes">
>;
const unavailable = () =>
  new NotFoundError("Notification webhook unavailable", undefined, { messageKey: "notification.webhookNotFound" });
const conflict = () =>
  new ConflictError("Webhook changed after authorization", undefined, { messageKey: "errors.conflict" });
function validTarget(row: NotificationWebhookTarget, principal: IamPrincipal) {
  return (
    row.userId === principal.subjectUserId &&
    row.status === MANAGED_STATUS.ENABLED &&
    row.preference.id === row.preferenceId &&
    row.preference.userId === principal.subjectUserId &&
    row.preference.status === MANAGED_STATUS.ENABLED
  );
}
function sameTarget(current: NotificationWebhookTarget, expected: NotificationWebhookTarget) {
  return (
    current.id === expected.id &&
    current.userId === expected.userId &&
    current.preferenceId === expected.preferenceId &&
    current.createTime.getTime() === expected.createTime.getTime() &&
    current.updateTime.getTime() === expected.updateTime.getTime() &&
    current.preference.updateTime.getTime() === expected.preference.updateTime.getTime()
  );
}
function publicView(row: NotificationWebhook): NotificationWebhookView {
  const { secret, ...view } = row;
  return { ...view, hasSecret: Boolean(secret) };
}
/** Request-only Webhook boundary: exact self ownership, active parent preference, current authorized snapshot. */
export class NotificationWebhookManagementRepository {
  private static instance: NotificationWebhookManagementRepository;
  static getInstance() {
    return (this.instance ??= new NotificationWebhookManagementRepository());
  }
  async assertPrincipal(principal: IamPrincipal) {
    await notificationAccountTransaction(principal, async () => undefined);
  }
  async scan(principal: IamPrincipal, after?: NotificationWebhookTarget) {
    return notificationAccountTransaction(principal, async (tx) => {
      const rows = await tx.notificationWebhook.findMany({
        where: {
          userId: principal.subjectUserId,
          status: MANAGED_STATUS.ENABLED,
          preference: { userId: principal.subjectUserId, status: MANAGED_STATUS.ENABLED },
          ...(after
            ? { OR: [{ createTime: { gt: after.createTime } }, { createTime: after.createTime, id: { gt: after.id } }] }
            : {}),
        },
        select: targetSelect,
        orderBy: [{ createTime: "asc" }, { id: "asc" }],
        take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
      });
      if (rows.some((row) => !validTarget(row, principal))) throw notificationAuthorizationDenied();
      return rows;
    });
  }
  async target(principal: IamPrincipal, id: string) {
    return notificationAccountTransaction(principal, async (tx) => {
      const row = await tx.notificationWebhook.findUnique({ where: { id }, select: targetSelect });
      if (!row || row.id !== id || !validTarget(row, principal)) throw unavailable();
      return row;
    });
  }
  private async current(
    tx: Prisma.TransactionClient,
    principal: IamPrincipal,
    expected: readonly NotificationWebhookTarget[],
  ) {
    const rows = await tx.notificationWebhook.findMany({
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
      if (!current || row.userId !== principal.subjectUserId || !validTarget(current, principal)) throw unavailable();
      if (!sameTarget(current, row)) throw conflict();
      return current;
    });
  }
  async hydrate(principal: IamPrincipal, expected: readonly NotificationWebhookTarget[]) {
    return notificationAccountTransaction(principal, async (tx) => {
      await this.current(tx, principal, expected);
      const rows = await tx.notificationWebhook.findMany({
        where: {
          id: { in: expected.map((row) => row.id) },
          userId: principal.subjectUserId,
          status: MANAGED_STATUS.ENABLED,
        },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      return expected.map((row) => publicView(byId.get(row.id)!));
    });
  }
  async create(
    principal: IamPrincipal,
    data: NotificationWebhookCreateInput,
    defaults: PreferenceDefaults,
  ): Promise<NotificationWebhookView> {
    return notificationAccountTransaction(principal, async (tx, email) => {
      let preference = await tx.notificationPreference.findUnique({ where: { userId: principal.subjectUserId } });
      if (preference && (preference.userId !== principal.subjectUserId || preference.status !== MANAGED_STATUS.ENABLED))
        throw notificationAuthorizationDenied();
      if (!preference)
        preference = await tx.notificationPreference.create({
          data: {
            userId: principal.subjectUserId,
            notificationEmail: email,
            subscribedEvents: defaults.subscribedEvents,
            knownEvents: defaults.knownEvents,
            thresholds: defaults.thresholds,
            cooldownMinutes: defaults.cooldownMinutes,
          },
        });
      const row = await tx.notificationWebhook.create({
        data: {
          userId: principal.subjectUserId,
          preferenceId: preference.id,
          name: data.name,
          url: data.url,
          format: data.format,
          secret: data.secret ?? null,
          enabled: data.enabled ?? true,
        },
      });
      return publicView(row);
    });
  }
  async update(
    principal: IamPrincipal,
    expected: NotificationWebhookTarget,
    data: NotificationWebhookUpdateInput,
  ): Promise<NotificationWebhookView> {
    return notificationAccountTransaction(principal, async (tx) => {
      await this.current(tx, principal, [expected]);
      const row = await tx.notificationWebhook.update({
        where: {
          id: expected.id,
          userId: principal.subjectUserId,
          preferenceId: expected.preferenceId,
          status: MANAGED_STATUS.ENABLED,
        },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.url !== undefined && { url: data.url }),
          ...(data.format !== undefined && { format: data.format }),
          ...(data.secret !== undefined && { secret: data.secret }),
          ...(data.enabled !== undefined && { enabled: data.enabled }),
        },
      });
      return publicView(row);
    });
  }
  async delete(principal: IamPrincipal, expected: NotificationWebhookTarget): Promise<NotificationWebhookView> {
    return notificationAccountTransaction(principal, async (tx) => {
      await this.current(tx, principal, [expected]);
      return publicView(
        await tx.notificationWebhook.update({
          where: {
            id: expected.id,
            userId: principal.subjectUserId,
            preferenceId: expected.preferenceId,
            status: MANAGED_STATUS.ENABLED,
          },
          data: { status: MANAGED_STATUS.DISABLED },
        }),
      );
    });
  }
}
