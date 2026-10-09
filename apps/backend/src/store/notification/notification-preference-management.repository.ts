import { Prisma, type NotificationPreference } from "@prisma/client";
import { MANAGED_STATUS, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { ConflictError, ForbiddenError } from "@/util/errors";
import type { NotificationPreferenceUpdateInput } from "./notification-preference.repository";

type PreferenceClient = Pick<Prisma.TransactionClient, "user" | "ramRoleSession" | "notificationPreference">;
type PreferenceDefaults = Omit<NotificationPreferenceUpdateInput, "notificationEmail">;
const denied = () =>
  new ForbiddenError("Notification preference identity or target unavailable", undefined, {
    messageKey: "permission.insufficientPermission",
  });
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
  private async actor(client: PreferenceClient, principal: IamPrincipal) {
    if (principal.subjectUserId !== principal.principalUserId) throw denied();
    const actor = await client.user.findUnique({
      where: { id: principal.subjectUserId },
      select: { id: true, status: true, accountOwnerId: true, email: true },
    });
    const owner = await client.user.findUnique({
      where: { id: principal.accountOwnerId },
      select: { id: true, status: true, accountOwnerId: true },
    });
    if (
      !actor ||
      actor.id !== principal.subjectUserId ||
      actor.status !== MANAGED_STATUS.ENABLED ||
      (actor.accountOwnerId || actor.id) !== principal.accountOwnerId ||
      !owner ||
      owner.id !== principal.accountOwnerId ||
      owner.status !== MANAGED_STATUS.ENABLED ||
      (owner.accountOwnerId || owner.id) !== principal.accountOwnerId
    )
      throw denied();
    if (principal.subjectType === "assumed_role" || principal.roleSessionId || principal.assumedRoleId) {
      if (principal.subjectType !== "assumed_role" || !principal.roleSessionId || !principal.assumedRoleId)
        throw denied();
      const session = await client.ramRoleSession.findUnique({
        where: { id: principal.roleSessionId },
        include: { role: { select: { id: true, status: true, accountOwnerId: true } } },
      });
      if (
        !session ||
        session.id !== principal.roleSessionId ||
        session.status !== MANAGED_STATUS.ENABLED ||
        session.subjectUserId !== actor.id ||
        session.accountOwnerId !== principal.accountOwnerId ||
        session.roleId !== principal.assumedRoleId ||
        session.revokedAt ||
        session.expiresAt <= new Date() ||
        session.role.id !== principal.assumedRoleId ||
        session.role.status !== MANAGED_STATUS.ENABLED ||
        session.role.accountOwnerId !== principal.accountOwnerId
      )
        throw denied();
    }
    return actor;
  }
  private async preference(client: PreferenceClient, userId: string) {
    const preference = await client.notificationPreference.findUnique({ where: { userId } });
    if (preference && (preference.userId !== userId || preference.status !== MANAGED_STATUS.ENABLED)) throw denied();
    return preference;
  }
  private async scoped<T>(
    principal: IamPrincipal,
    operation: (client: PreferenceClient, email: string | null) => Promise<T>,
  ) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const actor = await this.actor(tx, principal);
          return operation(tx, actor.email);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      // Do not retry against a new identity or silently overwrite concurrent initialization.
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002"))
        throw conflict();
      throw error;
    }
  }
  async find(principal: IamPrincipal) {
    return this.scoped(principal, (tx) => this.preference(tx, principal.subjectUserId));
  }
  async synchronize(
    principal: IamPrincipal,
    defaults: PreferenceDefaults | undefined,
    changesFor: (current: NotificationPreference) => NotificationPreferenceUpdateInput | undefined,
  ): Promise<NotificationPreference> {
    return this.scoped(principal, async (tx, email) => {
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
    return this.scoped(principal, async (tx) => {
      const current = await this.preference(tx, principal.subjectUserId);
      const changes = writeData(data);
      return current
        ? tx.notificationPreference.update({ where: { id: current.id }, data: changes })
        : tx.notificationPreference.create({ data: { userId: principal.subjectUserId, ...changes } });
    });
  }
}
