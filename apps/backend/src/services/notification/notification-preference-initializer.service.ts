import { ALL_NOTIFICATION_EVENTS, type IamPrincipal } from "@quyan/shared";
import type { NotificationPreference } from "@prisma/client";
import { ConfigService } from "@/services/system/config.service";
import { NotificationPreferenceRepository } from "@/store/notification/notification-preference.repository";
import { UserRepository } from "@/store/users/user.repository";
import { NotificationPreferenceManagementRepository } from "@/store/notification/notification-preference-management.repository";

export class NotificationPreferenceInitializerService {
  private static instance: NotificationPreferenceInitializerService;

  private constructor(
    private readonly repository = NotificationPreferenceRepository.getInstance(),
    private readonly configService = ConfigService.getInstance(),
    private readonly userRepository = UserRepository.getInstance(),
  ) {}

  static getInstance(): NotificationPreferenceInitializerService {
    if (!NotificationPreferenceInitializerService.instance)
      NotificationPreferenceInitializerService.instance = new NotificationPreferenceInitializerService();

    return NotificationPreferenceInitializerService.instance;
  }

  private normalizeEvents(value: unknown): string[] {
    if (!Array.isArray(value)) return [];

    return value.filter((event): event is string => typeof event === "string");
  }

  private initializationDefaults(config: Awaited<ReturnType<ConfigService["getNotificationConfig"]>>) {
    return {
      subscribedEvents: config.defaultSubscribedEvents,
      knownEvents: [...ALL_NOTIFICATION_EVENTS],
      thresholds: config.defaultThresholds,
      cooldownMinutes: 60,
    };
  }

  async getOrInitialize(userId: string) {
    const existing = await this.repository.findByUserId(userId);
    if (!existing) {
      const [config, user] = await Promise.all([
        this.configService.getNotificationConfig(),
        this.userRepository.findById(userId),
      ]);

      return await this.repository.upsertPreference(userId, {
        notificationEmail: user?.email ?? null,
        ...this.initializationDefaults(config),
      });
    }

    return this.syncKnownEvents(userId, existing);
  }

  /** API-only initialization; the authorization service must authorize before calling this method. */
  async getOrInitializeForAccount(principal: IamPrincipal): Promise<NotificationPreference> {
    const repository = NotificationPreferenceManagementRepository.getInstance();
    const current = await repository.find(principal);
    const config = current ? undefined : await this.configService.getNotificationConfig();
    return repository.synchronize(principal, config ? this.initializationDefaults(config) : undefined, (preference) =>
      this.knownEventChanges(preference),
    );
  }

  private knownEventChanges(existing: NotificationPreference) {
    const subscribedEvents = this.normalizeEvents(existing.subscribedEvents);
    const knownEvents = this.normalizeEvents(existing.knownEvents);
    if (knownEvents.length === 0) return { knownEvents: [...ALL_NOTIFICATION_EVENTS] };
    const knownEventSet = new Set(knownEvents);
    const newlyIntroducedEvents = ALL_NOTIFICATION_EVENTS.filter((event) => !knownEventSet.has(event));
    if (newlyIntroducedEvents.length === 0) return undefined;
    return {
      subscribedEvents: [...new Set([...subscribedEvents, ...newlyIntroducedEvents])],
      knownEvents: [...knownEvents, ...newlyIntroducedEvents],
    };
  }

  private async syncKnownEvents(userId: string, existing: NotificationPreference) {
    const changes = this.knownEventChanges(existing);
    return changes ? this.repository.upsertPreference(userId, changes) : existing;
  }
}
