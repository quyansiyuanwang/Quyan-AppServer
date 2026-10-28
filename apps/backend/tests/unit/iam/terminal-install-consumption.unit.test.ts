import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { TerminalInstallRegistrationIamService } from "@/services/remote-terminal/terminal-install-registration-iam.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { terminalInstallUserFingerprint } from "@/iam/resources/terminal-install-capability";
import { INSTALL_TOKEN_POLICY, type IamInstallTokenCapability } from "@/modules/remote-terminal/install-token";
import type { TypedRequest } from "@/types/express";
const snapshot = [
  { id: "actor", updateTime: new Date(0) },
  { id: "owner", updateTime: new Date(0) },
];
const capability = (): IamInstallTokenCapability => ({
  version: 2,
  entitlementId: "entitlement",
  issuedAt: Math.floor(Date.now() / 1000),
  grant: {
    principal: { subjectUserId: "actor", principalUserId: "actor", accountOwnerId: "owner", subjectType: "sub_user" },
    policyFingerprint: fingerprintIamPolicies([]),
    userFingerprint: terminalInstallUserFingerprint(snapshot),
    targetFingerprint: "a".repeat(64),
  },
});
const iam = { loadPolicies: vi.fn(), authorize: vi.fn() },
  users = { targets: vi.fn() },
  repository = { register: vi.fn() };
const service = new TerminalInstallRegistrationIamService(iam, users, repository);
const input = { fingerprint: "a".repeat(64), fingerprintVersion: "v1", snapshot: {} as never, cooldownMinutes: 60 };
const request = () =>
  ({
    headers: { "x-action": "client:Fake", "user-agent": "device-fixture" },
    ip: "192.0.2.44",
    secure: true,
    body: { accountId: "foreign", context: { "acs:SourceIp": "198.51.100.1" } },
  }) as unknown as TypedRequest;
beforeEach(() => {
  vi.resetAllMocks();
  users.targets.mockResolvedValue(snapshot);
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorize.mockResolvedValue({ decision: "Allow", reason: "fixture", matchedStatements: [] });
  repository.register.mockImplementation(async (_input, guard) => {
    await guard.users.recheck();
    return { deviceId: "device", heartbeatToken: "fixture-heartbeat", acceptedAt: new Date().toISOString() };
  });
});
describe("installation capability consumption authority", () => {
  it("takes identity only from signed metadata and transport facts from the current device request", async () => {
    await service.register(capability(), input, request());
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:remote_terminal:GetMyInstallToken",
        resource: "acs:remote-terminal:*:owner:product-entitlement/actor/entitlement",
        context: expect.objectContaining({
          "quyan:PrincipalId": "actor",
          "acs:SourceIp": "192.0.2.44",
          "acs:SecureTransport": true,
        }),
      }),
    );
    expect(repository.register).toHaveBeenCalledOnce();
  });
  it("rejects policy changes after issuance before entering persistence", async () => {
    iam.loadPolicies.mockResolvedValue([
      {
        policyId: "revoked",
        document: {
          Version: "1",
          Statement: [{ Effect: "Deny", Action: ["quyan:remote_terminal:GetMyInstallToken"], Resource: ["*"] }],
        },
      },
    ]);
    await expect(service.register(capability(), input, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.register).not.toHaveBeenCalled();
  });
  it("rejects a changed issuer revision and missing account members", async () => {
    users.targets.mockResolvedValue([{ ...snapshot[0], updateTime: new Date(1) }, snapshot[1]]);
    await expect(service.register(capability(), input, request())).rejects.toMatchObject({ statusCode: 403 });
    users.targets.mockResolvedValue([snapshot[0]]);
    await expect(service.register(capability(), input, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.register).not.toHaveBeenCalled();
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])(
    "rejects %s at consumption without returning a device credential",
    async (decision) => {
      iam.authorize.mockResolvedValue({ decision, reason: "fixture", matchedStatements: [] });
      await expect(service.register(capability(), input, request())).rejects.toMatchObject({ statusCode: 403 });
      expect(repository.register).not.toHaveBeenCalled();
    },
  );
  it("rechecks time and permissions at the persistence boundary", async () => {
    const source = capability();
    repository.register.mockImplementation(async (_input, guard) => {
      iam.authorize.mockResolvedValue({ decision: "ExplicitDeny", reason: "fixture", matchedStatements: [] });
      await guard.users.recheck();
    });
    await expect(service.register(source, input, request())).rejects.toMatchObject({ statusCode: 403 });
    source.issuedAt -= INSTALL_TOKEN_POLICY.ttlSeconds;
    await expect(service.register(source, input, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("preserves role sessions and AccessKey references in the registration guard", async () => {
    const source = capability();
    source.grant.principal.subjectType = "access_key";
    source.grant.accessKeyId = "key-id";
    await service.register(source, input, request());
    expect(repository.register.mock.calls[0][1].capability.grant.accessKeyId).toBe("key-id");
    source.grant.principal = {
      ...source.grant.principal,
      subjectType: "assumed_role",
      assumedRoleId: "role",
      roleSessionId: "session",
    };
    delete source.grant.accessKeyId;
    await service.register(source, input, request());
    expect(repository.register.mock.calls[1][1].users.principal.roleSessionId).toBe("session");
  });
  it("requires real request transport context and fails closed on unavailable authorization data", async () => {
    await expect(service.register(capability(), input)).rejects.toMatchObject({ statusCode: 403 });
    iam.loadPolicies.mockRejectedValue(new Error("fixture unavailable"));
    await expect(service.register(capability(), input, request())).rejects.toThrow("fixture unavailable");
    expect(repository.register).not.toHaveBeenCalled();
  });
});
