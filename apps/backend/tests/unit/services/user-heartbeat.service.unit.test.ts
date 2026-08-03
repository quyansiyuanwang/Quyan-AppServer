import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserHeartbeatService } from "../../../src/services/users/user-heartbeat.service";

describe("UserHeartbeatService", () => {
  const sessionRepository = {
    closeExpiredSessions: vi.fn().mockResolvedValue(undefined),
    findActiveByUserIdAndAuthSessionId: vi.fn(),
    createSession: vi.fn(),
    updateHeartbeat: vi.fn(),
  };
  const configService = {
    getHeartbeatConfig: vi.fn().mockResolvedValue({ timeoutSeconds: 60, intervalSeconds: 30 }),
  };
  const ipGeolocationService = {
    getLocation: vi.fn().mockResolvedValue("广东省深圳市"),
  };
  const businessLogService = {
    logOperation: vi.fn().mockResolvedValue(undefined),
  };
  const userRepository = {
    findById: vi.fn().mockResolvedValue({ id: "user-1", username: "alice" }),
  };
  const redisService = {
    get: vi.fn().mockResolvedValue(null),
  };

  const ServiceCtor = UserHeartbeatService as unknown as new (...args: any[]) => UserHeartbeatService;

  beforeEach(() => {
    vi.clearAllMocks();
    configService.getHeartbeatConfig.mockResolvedValue({ timeoutSeconds: 60, intervalSeconds: 30 });
    ipGeolocationService.getLocation.mockResolvedValue("广东省深圳市");
    userRepository.findById.mockResolvedValue({ id: "user-1", username: "alice" });
    redisService.get.mockResolvedValue(null);
    sessionRepository.findActiveByUserIdAndAuthSessionId.mockResolvedValue(null);
    sessionRepository.createSession.mockResolvedValue({
      id: "session-1",
      lastHeartbeatAt: new Date("2026-05-27T00:00:00.000Z"),
    });
  });

  it("does not write a business log when creating a new online session from heartbeat", async () => {
    const service = new ServiceCtor(
      sessionRepository as any,
      configService as any,
      ipGeolocationService as any,
      businessLogService as any,
      userRepository as any,
      redisService as any,
    );

    const request = {
      headers: {
        cookie: "auth_session_id=test-session",
        "user-agent": "vitest",
        "x-request-id": "req-1",
      },
      user: { userId: "user-1" },
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      res: { cookie: vi.fn() },
    } as any;

    await service.recordHeartbeat("user-1", request);

    expect(sessionRepository.createSession).toHaveBeenCalledTimes(1);
    expect(businessLogService.logOperation).not.toHaveBeenCalled();
  });
});
