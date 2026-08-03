import { beforeEach, describe, expect, it, vi } from "vitest";
import { MANAGED_STATUS } from "@/constant/status";
import { RemoteTerminalDeviceRegistry } from "@/modules/remote-terminal/gateway/device-registry";
import { ConfigService } from "@/services/system/config.service";
import { RemoteTerminalProductRepository } from "@/store/remote-terminal-product/remote-terminal-product.repository";

describe("RemoteTerminalDeviceRegistry register", () => {
  const productRepository = {
    findActiveEntitlementByToken: vi.fn(),
    findActiveEntitlementById: vi.fn(),
    findDeviceBindingByEntitlementAndFingerprint: vi.fn(),
    countActiveDeviceBindingsForEntitlement: vi.fn(),
    createDeviceBinding: vi.fn(),
    updateDeviceBinding: vi.fn(),
    touchEntitlementToken: vi.fn(),
  };

  let registry: RemoteTerminalDeviceRegistry;

  const entitlement = {
    id: "ent-1",
    userId: "user-1",
    status: MANAGED_STATUS.ENABLED,
    endAt: new Date("2026-12-31T00:00:00.000Z"),
    startAt: new Date("2026-01-01T00:00:00.000Z"),
    deviceLimit: 2,
    registrationToken: { id: "token-1" },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(RemoteTerminalProductRepository, "getInstance").mockReturnValue(productRepository as any);
    vi.spyOn(ConfigService, "getInstance").mockReturnValue({
      getRemoteTerminalUnbindConfig: vi.fn().mockResolvedValue({
        maxCount: 3,
        windowHours: 24,
        rebindCooldownMinutes: 60,
      }),
    } as any);
    productRepository.findActiveEntitlementByToken.mockResolvedValue(entitlement);
    productRepository.findActiveEntitlementById.mockResolvedValue(entitlement);
    productRepository.findDeviceBindingByEntitlementAndFingerprint.mockResolvedValue(null);
    productRepository.countActiveDeviceBindingsForEntitlement.mockResolvedValue(0);
    productRepository.createDeviceBinding.mockResolvedValue({
      deviceId: "device-1",
      fingerprint: "a".repeat(64),
      fingerprintVersion: "v1",
      heartbeatToken: "hb-1",
      registeredAt: new Date("2026-06-17T00:00:00.000Z"),
      lastSeenAt: new Date("2026-06-17T00:00:00.000Z"),
      online: false,
      entitlementId: "ent-1",
      snapshot: {
        hostname: "host",
        platform: "windows",
        arch: "x64",
        agentVersion: "1.0.0",
        capabilities: {
          sshForward: false,
          nativePty: false,
          selfUpdate: false,
          proxyAware: false,
          serviceManaged: false,
          sessionRecording: false,
        },
        diagnostics: {
          installFormats: [],
          serviceManager: "service",
          defaultLogPath: "log",
          availableShells: [],
          sshCheck: { available: false, detail: "" },
          notes: [],
        },
      },
      entitlement: { status: MANAGED_STATUS.ENABLED, endAt: entitlement.endAt },
    } as any);
    productRepository.updateDeviceBinding.mockResolvedValue({
      deviceId: "device-1",
      fingerprint: "a".repeat(64),
      fingerprintVersion: "v1",
      heartbeatToken: "hb-2",
      registeredAt: new Date("2026-06-17T00:00:00.000Z"),
      lastSeenAt: new Date("2026-06-17T00:00:00.000Z"),
      online: false,
      entitlementId: "ent-1",
      snapshot: {
        hostname: "host",
        platform: "windows",
        arch: "x64",
        agentVersion: "1.0.0",
        capabilities: {
          sshForward: false,
          nativePty: false,
          selfUpdate: false,
          proxyAware: false,
          serviceManaged: false,
          sessionRecording: false,
        },
        diagnostics: {
          installFormats: [],
          serviceManager: "service",
          defaultLogPath: "log",
          availableShells: [],
          sshCheck: { available: false, detail: "" },
          notes: [],
        },
      },
      entitlement: { status: MANAGED_STATUS.ENABLED, endAt: entitlement.endAt },
    } as any);
    productRepository.touchEntitlementToken.mockResolvedValue(undefined);
    registry = new RemoteTerminalDeviceRegistry();
  });

  it("creates a new binding with fingerprint version", async () => {
    const result = await registry.register({
      registrationToken: "rtm_test_token",
      deviceFingerprint: "a".repeat(64),
      fingerprintVersion: "v1",
      snapshot: {
        hostname: "host",
        platform: "windows",
        arch: "x64",
        agentVersion: "1.0.0",
        capabilities: {
          sshForward: false,
          nativePty: false,
          selfUpdate: false,
          proxyAware: false,
          serviceManaged: false,
          sessionRecording: false,
        },
        diagnostics: {
          installFormats: [],
          serviceManager: "service",
          defaultLogPath: "log",
          availableShells: [],
          sshCheck: { available: false, detail: "" },
          notes: [],
        },
      },
    });

    expect(result.deviceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(productRepository.createDeviceBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: result.deviceId,
        fingerprintVersion: "v1",
        fingerprint: "a".repeat(64),
      }),
    );
    expect(productRepository.updateDeviceBinding).not.toHaveBeenCalled();
  });

  it("reuses the same binding for the same fingerprint", async () => {
    productRepository.findDeviceBindingByEntitlementAndFingerprint.mockResolvedValueOnce({
      id: "binding-1",
      deviceId: "device-1",
      fingerprint: "a".repeat(64),
      fingerprintVersion: "v1",
      heartbeatToken: "hb-old",
      registeredAt: new Date("2026-06-16T00:00:00.000Z"),
      lastSeenAt: new Date("2026-06-16T00:00:00.000Z"),
      lastOnlineAt: null,
      online: true,
      status: MANAGED_STATUS.ENABLED,
      entitlementId: "ent-1",
      userId: "user-1",
      registrationTokenId: "token-1",
      hostname: "host",
      platform: "windows",
      arch: "x64",
      snapshot: {},
      entitlement: { status: MANAGED_STATUS.ENABLED, endAt: entitlement.endAt, startAt: entitlement.startAt },
      user: { username: "alice" },
      registrationToken: { id: "token-1" },
      createTime: new Date("2026-06-16T00:00:00.000Z"),
      updateTime: new Date("2026-06-16T00:00:00.000Z"),
    } as any);

    const result = await registry.register({
      registrationToken: "rtm_test_token",
      deviceFingerprint: "a".repeat(64),
      fingerprintVersion: "v1",
      snapshot: {
        hostname: "host",
        platform: "windows",
        arch: "x64",
        agentVersion: "1.0.0",
        capabilities: {
          sshForward: false,
          nativePty: false,
          selfUpdate: false,
          proxyAware: false,
          serviceManaged: false,
          sessionRecording: false,
        },
        diagnostics: {
          installFormats: [],
          serviceManager: "service",
          defaultLogPath: "log",
          availableShells: [],
          sshCheck: { available: false, detail: "" },
          notes: [],
        },
      },
    });

    expect(result.deviceId).toBe("device-1");
    expect(productRepository.updateDeviceBinding).toHaveBeenCalledWith(
      "binding-1",
      expect.objectContaining({
        fingerprintVersion: "v1",
        fingerprint: "a".repeat(64),
      }),
    );
    expect(productRepository.createDeviceBinding).not.toHaveBeenCalled();
  });

  it("blocks rebind during cooldown after revoke", async () => {
    productRepository.findDeviceBindingByEntitlementAndFingerprint.mockResolvedValueOnce({
      id: "binding-1",
      deviceId: "device-1",
      fingerprint: "a".repeat(64),
      fingerprintVersion: "v1",
      heartbeatToken: "hb-old",
      registeredAt: new Date("2026-06-16T00:00:00.000Z"),
      lastSeenAt: new Date("2026-06-16T00:00:00.000Z"),
      lastOnlineAt: null,
      online: false,
      status: MANAGED_STATUS.DELETED,
      entitlementId: "ent-1",
      userId: "user-1",
      registrationTokenId: "token-1",
      hostname: "host",
      platform: "windows",
      arch: "x64",
      snapshot: {},
      entitlement: { status: MANAGED_STATUS.ENABLED, endAt: entitlement.endAt, startAt: entitlement.startAt },
      user: { username: "alice" },
      registrationToken: { id: "token-1" },
      createTime: new Date("2026-06-16T00:00:00.000Z"),
      updateTime: new Date(),
    } as any);

    await expect(
      registry.register({
        registrationToken: "rtm_test_token",
        deviceFingerprint: "a".repeat(64),
        fingerprintVersion: "v1",
        snapshot: {
          hostname: "host",
          platform: "windows",
          arch: "x64",
          agentVersion: "1.0.0",
          capabilities: {
            sshForward: false,
            nativePty: false,
            selfUpdate: false,
            proxyAware: false,
            serviceManaged: false,
            sessionRecording: false,
          },
          diagnostics: {
            installFormats: [],
            serviceManager: "service",
            defaultLogPath: "log",
            availableShells: [],
            sshCheck: { available: false, detail: "" },
            notes: [],
          },
        },
      }),
    ).rejects.toThrow(/cooling down/i);
  });
});
