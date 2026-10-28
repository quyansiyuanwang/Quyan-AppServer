import type { NotificationPreference, Prisma } from "@prisma/client";
import { MANAGED_STATUS, type IamPrincipal } from "@quyan/shared";
import { ConflictError } from "@/util/errors";
import { notificationAccountTransaction, notificationAuthorizationDenied } from "./notification-account-guard";
import type { NotificationPreferenceUpdateInput } from "./notification-preference.repository";

type PreferenceDefaults = Omit<NotificationPreferenceUpdateInput, "notificationEmail">;
const conflict = () =>
  new ConflictError("Notification preference changed concurrently", undefined, {
    messageKey: "errors.conflict",
  });
/** Only the preference contract is persisted; identity and lifecycle fields are never writable. */
function writeData(data: NotificationPreferenceUpdateInput) {
  return {
    ...(data.notificationEmail !== undefined && { notificationEmail: data.notificationEmail }),
    ...(data.subscribedEvents !== undefined && { subscribedEvents: data.subscribedEvents }),
    ...(data.knownEvents !== undefined && { knownEvents: data.knownEvents }),
    ...(data.thresholds !== undefined && { thresholds: data.thresholds }),
    ...(data.cooldownMinutes !== undefined && { cooldownMinutes: data.cooldownMinutes }),
  };
}
/** Request-only persistence boundary. Background delivery retains the separate initializer path. */
export class NotificationPreferenceManagementRepository {
  private static instance: NotificationPreferenceManagementRepository;
  static getInstance() {
    return (this.instance ??= new NotificationPreferenceManagementRepository());
  }
  private async preference(client: Prisma.TransactionClient, userId: string) {
    const preference = await client.notificationPreference.findUnique({ where: { userId } });
    if (preference && (preference.userId !== userId || preference.status !== MANAGED_STATUS.ENABLED))
      throw notificationAuthorizationDenied();
    return preference;
  }
  async find(principal: IamPrincipal) {
    return notificationAccountTransaction(principal, (tx) => this.preference(tx, principal.subjectUserId));
  }
  async synchronize(
    principal: IamPrincipal,
    defaults: PreferenceDefaults | undefined,
    changesFor: (current: NotificationPreference) => NotificationPreferenceUpdateInput | undefined,
  ): Promise<NotificationPreference> {
    return notificationAccountTransaction(principal, async (tx, email) => {
      const current = await this.preference(tx, principal.subjectUserId);
      if (!current) {
        if (!defaults) throw conflict();
        return tx.notificationPreference.create({
          data: {
            userId: principal.subjectUserId,
            notificationEmail: email,
            ...writeData(defaults),
          },
        });
      }
      // Derive event synchronization from the transaction's current record, not a stale pre-read.
      const changes = changesFor(current);
      return changes
        ? tx.notificationPreference.update({ where: { id: current.id }, data: writeData(changes) })
        : current;
    });
  }
  async update(principal: IamPrincipal, data: NotificationPreferenceUpdateInput): Promise<NotificationPreference> {
    return notificationAccountTransaction(principal, async (tx) => {
      const current = await this.preference(tx, principal.subjectUserId);
      const changes = writeData(data);
      return current
        ? tx.notificationPreference.update({ where: { id: current.id }, data: changes })
        : tx.notificationPreference.create({ data: { userId: principal.subjectUserId, ...changes } });
    });
  }
}
