import { MANAGED_STATUS, type IamPrincipal } from "@quyan/shared";
import type { NotificationPreference, Prisma } from "@prisma/client";
import { ConflictError } from "@/util/errors";
import { notificationAccountTransaction, notificationAuthorizationDenied } from "./notification-account-guard";
import type { NotificationDocument } from "@/services/notification/notification-template";
/** Test email side effects use the exact authorized preference snapshot and executing identity. */
export class NotificationTestEmailRepository {
  private static instance: NotificationTestEmailRepository;
  static getInstance() {
    return (this.instance ??= new NotificationTestEmailRepository());
  }
  async prepare(principal: IamPrincipal, expected: NotificationPreference, document: NotificationDocument) {
    return notificationAccountTransaction(principal, async (tx) => {
      const current = await tx.notificationPreference.findUnique({ where: { userId: principal.subjectUserId } });
      if (
        !current ||
        current.id !== expected.id ||
        current.userId !== principal.subjectUserId ||
        current.status !== MANAGED_STATUS.ENABLED ||
        !current.notificationEmail
      )
        throw notificationAuthorizationDenied();
      if (
        current.updateTime.getTime() !== expected.updateTime.getTime() ||
        current.notificationEmail !== expected.notificationEmail
      )
        throw new ConflictError("Notification email target changed after authorization", undefined, {
          messageKey: "errors.conflict",
        });
      const inbox = await tx.notificationInboxItem.create({
        data: {
          userId: principal.subjectUserId,
          eventType: document.event,
          title: document.subject,
          content: document.summary,
          metadata: { ...(document.metadata ?? {}), document } as unknown as Prisma.InputJsonValue,
        },
      });
      return { email: current.notificationEmail, inboxItemId: inbox.id };
    });
  }
}
