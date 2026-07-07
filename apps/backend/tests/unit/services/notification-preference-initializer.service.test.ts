import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationPreferenceInitializerService } from "../../../src/services/notification/notification-preference-initializer.service";
import { NotificationPreferenceRepository } from "../../../src/store/notification/notification-preference.repository";
import { ConfigService } from "../../../src/services/system/config.service";
import { UserRepository } from "../../../src/store/users/user.repository";
import { ALL_NOTIFICATION_EVENTS, NotificationEvent } from "../../../src/constant/notification-event";

vi.mock("../../../src/store/notification/notification-preference.repository");
vi.mock("../../../src/services/system/config.service");
vi.mock("../../../src/store/users/user.repository");

const repositoryMock = {
  findByUserId: vi.fn(),
  upsertPreference: vi.fn(),
};

const configServiceMock = {
  getNotificationConfig: vi.fn(),
};

const userRepositoryMock = {
  findById: vi.fn(),
};

describe("NotificationPreferenceInitializerService", () => {
  let service: NotificationPreferenceInitializerService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(NotificationPreferenceRepository, "getInstance").mockReturnValue(
      repositoryMock as unknown as NotificationPreferenceRepository,
    );
    vi.spyOn(ConfigService, "getInstance").mockReturnValue(configServiceMock as unknown as ConfigService);
    vi.spyOn(UserRepository, "getInstance").mockReturnValue(userRepositoryMock as unknown as UserRepository);
    (NotificationPreferenceInitializerService as any).instance = undefined;
    service = new (NotificationPreferenceInitializerService as any)(
      repositoryMock,
      configServiceMock,
      userRepositoryMock,
    );
  });

  it("returns existing preference without reinitializing", async () => {
    const existing = { id: "pref-1", userId: "user-1", subscribedEvents: [NotificationEvent.BALANCE_LOW] };
    repositoryMock.findByUserId.mockResolvedValue(existing);

    const result = await service.getOrInitialize("user-1");

    expect(result).toBe(existing);
    expect(configServiceMock.getNotificationConfig).not.toHaveBeenCalled();
    expect(repositoryMock.upsertPreference).not.toHaveBeenCalled();
  });

  it("initializes email, subscribed events and default thresholds on first run", async () => {
    repositoryMock.findByUserId.mockResolvedValue(null);
    configServiceMock.getNotificationConfig.mockResolvedValue({
      defaultSubscribedEvents: [NotificationEvent.BALANCE_LOW, NotificationEvent.MONTHLY_PASS_QUOTA_LOW],
      defaultThresholds: {
        [NotificationEvent.BALANCE_LOW]: 10,
        [NotificationEvent.MONTHLY_PASS_QUOTA_LOW]: 20,
        [NotificationEvent.MONTHLY_PASS_DAILY_LIMIT]: 80,
        [NotificationEvent.RELAY_TOKEN_QUOTA_LOW]: 80,
      },
    });
    userRepositoryMock.findById.mockResolvedValue({ email: "seed@example.com" });
    repositoryMock.upsertPreference.mockResolvedValue({ id: "pref-new", userId: "user-1" });

    await service.getOrInitialize("user-1");

    expect(repositoryMock.upsertPreference).toHaveBeenCalledWith("user-1", {
      notificationEmail: "seed@example.com",
      subscribedEvents: [NotificationEvent.BALANCE_LOW, NotificationEvent.MONTHLY_PASS_QUOTA_LOW],
      thresholds: {
        [NotificationEvent.BALANCE_LOW]: 10,
        [NotificationEvent.MONTHLY_PASS_QUOTA_LOW]: 20,
        [NotificationEvent.MONTHLY_PASS_DAILY_LIMIT]: 80,
        [NotificationEvent.RELAY_TOKEN_QUOTA_LOW]: 80,
      },
      cooldownMinutes: 60,
    });
  });

  it("subscribes all notification events by default when config is absent", async () => {
    repositoryMock.findByUserId.mockResolvedValue(null);
    configServiceMock.getNotificationConfig.mockResolvedValue({
      defaultSubscribedEvents: [...ALL_NOTIFICATION_EVENTS],
      defaultThresholds: {
        [NotificationEvent.BALANCE_LOW]: 10,
        [NotificationEvent.MONTHLY_PASS_QUOTA_LOW]: 20,
        [NotificationEvent.MONTHLY_PASS_DAILY_LIMIT]: 80,
        [NotificationEvent.RELAY_TOKEN_QUOTA_LOW]: 80,
      },
    });
    userRepositoryMock.findById.mockResolvedValue({ email: "seed@example.com" });
    repositoryMock.upsertPreference.mockResolvedValue({ id: "pref-new", userId: "user-1" });

    await service.getOrInitialize("user-1");

    expect(repositoryMock.upsertPreference).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        subscribedEvents: [...ALL_NOTIFICATION_EVENTS],
      }),
    );
    expect((repositoryMock.upsertPreference as any).mock.calls[0][1].subscribedEvents).toContain(
      NotificationEvent.TICKET_STATUS_UPDATED,
    );
    expect((repositoryMock.upsertPreference as any).mock.calls[0][1].subscribedEvents).toContain(
      NotificationEvent.TICKET_PUBLIC_REPLY,
    );
    expect((repositoryMock.upsertPreference as any).mock.calls[0][1].subscribedEvents).toContain(
      NotificationEvent.TICKET_ASSIGNED,
    );
  });
});
