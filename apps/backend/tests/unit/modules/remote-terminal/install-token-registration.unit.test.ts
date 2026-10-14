import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "@/config/env";
import {
  issueIamInstallToken,
  issueInstallToken,
  type IamInstallTokenGrant,
} from "@/modules/remote-terminal/install-token";
import { RemoteTerminalDeviceRegistry } from "@/modules/remote-terminal/gateway/device-registry";
import { TerminalInstallRegistrationIamService } from "@/services/remote-terminal/terminal-install-registration-iam.service";
import { RemoteTerminalProductRepository } from "@/store/remote-terminal-product/remote-terminal-product.repository";
import { ConfigService } from "@/services/system/config.service";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode,
  oldSecret = env.integrations.remoteTerminal.installTokenSecret;
const SECRET = "fixture-only-registration-codec-".repeat(4);
const grant: IamInstallTokenGrant = {
  principal: { subjectUserId: "actor", principalUserId: "actor", accountOwnerId: "owner", subjectType: "sub_user" },
  policyFingerprint: "a".repeat(64),
  userFingerprint: "b".repeat(64),
  targetFingerprint: "c".repeat(64),
};
const native = { register: vi.fn() },
  legacy = { findActiveEntitlementById: vi.fn() };
const payload = (token: string) => ({
  registrationToken: token,
  deviceFingerprint: " A".trim() + "a".repeat(63),
  fingerprintVersion: " V1 ",
  snapshot: {} as never,
});
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  env.integrations.remoteTerminal.installTokenSecret = SECRET;
  vi.spyOn(TerminalInstallRegistrationIamService, "getInstance").mockReturnValue(native as never);
  vi.spyOn(RemoteTerminalProductRepository, "getInstance").mockReturnValue(legacy as never);
  vi.spyOn(ConfigService, "getInstance").mockReturnValue({
    getRemoteTerminalUnbindConfig: vi.fn().mockResolvedValue({ rebindCooldownMinutes: 60 }),
  } as never);
  native.register.mockResolvedValue({
    deviceId: "device",
    heartbeatToken: "fixture-only",
    acceptedAt: new Date().toISOString(),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
  env.integrations.remoteTerminal.installTokenSecret = oldSecret;
});
describe("device registry IAM install-token boundary", () => {
  it.each(["legacy", "shadow", "enforce"] as const)(
    "routes signed capabilities through native enforcement in %s",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      const req = { headers: { "x-action": "client:Fake" } } as unknown as TypedRequest;
      const result = await new RemoteTerminalDeviceRegistry().register(
        payload(issueIamInstallToken("entitlement", SECRET, grant).token),
        req,
      );
      expect(native.register).toHaveBeenCalledWith(
        expect.objectContaining({ grant }),
        expect.objectContaining({ fingerprint: "a".repeat(64), fingerprintVersion: "v1", cooldownMinutes: 60 }),
        req,
      );
      expect(legacy.findActiveEntitlementById).not.toHaveBeenCalled();
      expect(result.deviceId).toBe("device");
    },
  );
  it("rejects compatibility install credentials in enforce before reading entitlement data", async () => {
    await expect(
      new RemoteTerminalDeviceRegistry().register(payload(issueInstallToken("entitlement", SECRET).token)),
    ).rejects.toThrow("Reissue an IAM installation token");
    expect(legacy.findActiveEntitlementById).not.toHaveBeenCalled();
    expect(native.register).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)(
    "retains the legacy entitlement lookup for compatibility credentials in %s",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      legacy.findActiveEntitlementById.mockResolvedValue(null);
      await expect(
        new RemoteTerminalDeviceRegistry().register(payload(issueInstallToken("entitlement", SECRET).token)),
      ).rejects.toThrow("Invalid or expired registration token");
      expect(legacy.findActiveEntitlementById).toHaveBeenCalledWith("entitlement", expect.any(Date));
      expect(native.register).not.toHaveBeenCalled();
    },
  );
  it("rejects an invalid signed credential before either persistence path", async () => {
    await expect(
      new RemoteTerminalDeviceRegistry().register(
        payload(issueIamInstallToken("entitlement", SECRET, grant).token + "tampered"),
      ),
    ).rejects.toThrow("Invalid or expired install token");
    expect(legacy.findActiveEntitlementById).not.toHaveBeenCalled();
    expect(native.register).not.toHaveBeenCalled();
  });
});
