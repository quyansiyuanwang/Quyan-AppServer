import { ALL_NOTIFICATION_EVENTS } from "@appserver/shared";
import { ConfigService } from "@/services/system/config.service";
import { NotificationPreferenceRepository } from "@/store/notification/notification-preference.repository";
import { UserRepository } from "@/store/users/user.repository";

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

  async getOrInitialize(userId: string) {
    const existing = await this.repository.findByUserId(userId);
    if (!existing) {
      const [config, user] = await Promise.all([
        this.configService.getNotificationConfig(),
        this.userRepository.findById(userId),
      ]);

      return await this.repository.upsertPreference(userId, {
        notificationEmail: user?.email ?? null,
        subscribedEvents: config.defaultSubscribedEvents,
        thresholds: config.defaultThresholds,
        cooldownMinutes: 60,
      });
    }

    // Merge any new events (added after user initialized their preferences)
    // into the user's subscribed list so they default to enabled.
    const existingEvents = new Set(existing.subscribedEvents as string[]);
    const missingEvents = ALL_NOTIFICATION_EVENTS.filter((e) => !existingEvents.has(e));

    if (missingEvents.length > 0) {
      existing.subscribedEvents = [...(existing.subscribedEvents as string[]), ...missingEvents];
      await this.repository.upsertPreference(userId, {
        subscribedEvents: existing.subscribedEvents as string[],
      });
    }

    return existing;
  }
}
