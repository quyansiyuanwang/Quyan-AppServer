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
    if (existing) return existing;

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
}
