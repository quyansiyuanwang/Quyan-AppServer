import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  mode: "enforce",
  generate: vi.fn(),
  verify: vi.fn(),
  permission: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("@/config/env", () => ({
  env: {
    security: {
      get iamAuthorizationMode() {
        return mocks.mode;
      },
    },
    auth: { webAuthn: { rpName: "fixture", rpId: "localhost", origins: ["https://localhost"] } },
  },
}));
vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: mocks.generate,
  verifyRegistrationResponse: mocks.verify,
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));
vi.mock("@/store/users/user.repository", () => ({ UserRepository: { getInstance: vi.fn() } }));
vi.mock("@/store/auth/passkey-credential.repository", () => ({
  PasskeyCredentialRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/infrastructure/redis.service", () => ({ RedisService: { getInstance: vi.fn() } }));
vi.mock("@/services/auth/passkey-iam.service", () => ({ PasskeyIamService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({
  PermissionService: { getInstance: () => ({ checkUserPermissions: mocks.permission }) },
}));
vi.mock("@/store/auth/passkey-management.repository", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    PasskeyManagementRepository: { getInstance: vi.fn() },
    passkeyDenied: () =>
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
vi.mock("@/util/logger", () => ({
  getLogger: () => ({ warn: mocks.warn }),
  LogCategory: { APPLICATION: "application" },
}));
import { PasskeyService } from "@/services/auth/passkey.service";
import type { TypedRequest } from "@/types/express";
let service: PasskeyService, redis: any, users: any, credentials: any, iam: any, management: any, request: TypedRequest;
const identity = {
  principal: { subjectUserId: "actor", principalUserId: "actor", accountOwnerId: "owner", subjectType: "sub_user" },
  snapshot: { id: "actor", username: "fixture", name: null, updateTime: new Date(0), ownerUpdateTime: new Date(0) },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.mode = "enforce";
  mocks.generate.mockResolvedValue({ challenge: "fixture-challenge" });
  mocks.verify.mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: { id: "webauthn-id", publicKey: new Uint8Array([1, 2]), counter: 0, transports: ["internal"] },
      credentialDeviceType: "singleDevice",
      credentialBackedUp: false,
    },
  });
  mocks.permission.mockResolvedValue({ hasPermission: true });
  redis = {
    get: vi.fn().mockResolvedValue("fixture-challenge"),
    set: vi.fn(),
    delete: vi.fn(),
    deleteIfValueMatches: vi.fn().mockResolvedValue(true),
  };
  users = { findById: vi.fn().mockResolvedValue(identity.snapshot) };
  credentials = {
    create: vi.fn(),
    findRegistrationViewByUserId: vi.fn(),
    listByUserId: vi.fn().mockResolvedValue([]),
    findByCredentialId: vi.fn().mockResolvedValue({ userId: "actor" }),
    deleteByCredentialId: vi.fn(),
  };
  iam = {
    authorizeRegistration: vi.fn().mockResolvedValue(identity),
    list: vi.fn().mockResolvedValue([]),
    revoke: vi.fn(),
    authorizeDeletion: vi.fn(),
  };
  management = { create: vi.fn() };
  service = new (PasskeyService as unknown as new (...args: any[]) => PasskeyService)(
    redis,
    users,
    credentials,
    iam,
    management,
  );
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: {},
  } as unknown as TypedRequest;
});
describe("Passkey registration and rollout guards", () => {
  it("does not disclose unrelated credential IDs or read full users for registration options", async () => {
    await service.generateRegistrationOptions("actor", request);
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ userName: "fixture" }));
    expect(mocks.generate.mock.calls[0][0]).not.toHaveProperty("excludeCredentials");
    expect(credentials.findRegistrationViewByUserId).not.toHaveBeenCalled();
    expect(users.findById).not.toHaveBeenCalled();
    expect(iam.authorizeRegistration).toHaveBeenCalledTimes(2);
  });
  it("rechecks options authorization before storing the challenge", async () => {
    iam.authorizeRegistration.mockResolvedValueOnce(identity).mockRejectedValueOnce(new Error("revoked"));
    await expect(service.generateRegistrationOptions("actor", request)).rejects.toThrow("revoked");
    expect(redis.set).not.toHaveBeenCalled();
  });
  it("verifies WebAuthn, consumes the verified challenge, reauthorizes and persists the original actor snapshot", async () => {
    expect(await service.verifyRegistration("actor", { id: "webauthn-id" } as never, "fixture", request)).toEqual({
      success: true,
      credentialId: "webauthn-id",
    });
    expect(mocks.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: "fixture-challenge",
        expectedOrigin: ["https://localhost"],
        expectedRPID: "localhost",
      }),
    );
    expect(redis.deleteIfValueMatches).toHaveBeenCalledWith("passkey:challenge:reg:actor", "fixture-challenge");
    expect(iam.authorizeRegistration).toHaveBeenCalledTimes(2);
    expect(management.create).toHaveBeenCalledWith(
      identity.principal,
      identity.snapshot,
      expect.objectContaining({ userId: "actor", name: "fixture" }),
    );
    expect(credentials.create).not.toHaveBeenCalled();
    expect(redis.delete).not.toHaveBeenCalled();
  });
  it.each([false, null])("fails closed when challenge consumption returns %s", async (result) => {
    redis.deleteIfValueMatches.mockResolvedValue(result);
    await expect(service.verifyRegistration("actor", {} as never, undefined, request)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(management.create).not.toHaveBeenCalled();
  });
  it("does not persist after registration permission is revoked during WebAuthn verification", async () => {
    iam.authorizeRegistration.mockResolvedValueOnce(identity).mockRejectedValueOnce(new Error("revoked"));
    await expect(service.verifyRegistration("actor", {} as never, undefined, request)).rejects.toThrow("revoked");
    expect(management.create).not.toHaveBeenCalled();
  });
  it("does not expose verifier errors in warnings", async () => {
    mocks.verify.mockRejectedValue(new Error("secret authenticator data"));
    await expect(service.verifyRegistration("actor", {} as never, undefined, request)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("secret authenticator data");
    expect(redis.deleteIfValueMatches).not.toHaveBeenCalled();
  });
  it("rejects expired and unverified registration", async () => {
    redis.get.mockResolvedValueOnce(null);
    await expect(service.verifyRegistration("actor", {} as never, undefined, request)).rejects.toMatchObject({
      statusCode: 400,
    });
    mocks.verify.mockResolvedValue({ verified: false });
    await expect(service.verifyRegistration("actor", {} as never, undefined, request)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(management.create).not.toHaveBeenCalled();
  });
  it("enforce delegates listing and deletion without legacy payload reads", async () => {
    await service.listCredentials("actor", request);
    await service.deleteCredential("actor", "webauthn-id", request);
    expect(iam.list).toHaveBeenCalledWith("actor", request);
    expect(iam.revoke).toHaveBeenCalledWith("actor", "webauthn-id", request);
    expect(credentials.listByUserId).not.toHaveBeenCalled();
    expect(credentials.findByCredentialId).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"])("%s preserves old permission enforcement", async (mode) => {
    mocks.mode = mode;
    mocks.permission.mockResolvedValue({ hasPermission: false });
    await expect(service.listCredentials("actor", request)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.deleteCredential("actor", "webauthn-id", request)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.generateRegistrationOptions("actor", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(credentials.listByUserId).not.toHaveBeenCalled();
    expect(credentials.deleteByCredentialId).not.toHaveBeenCalled();
  });
  it("shadow evaluates deletion but mutates once through the legacy path", async () => {
    mocks.mode = "shadow";
    await service.deleteCredential("actor", "webauthn-id", request);
    expect(iam.authorizeDeletion).toHaveBeenCalledWith("actor", "webauthn-id", request);
    expect(iam.revoke).not.toHaveBeenCalled();
    expect(credentials.deleteByCredentialId).toHaveBeenCalledTimes(1);
  });
  it("shadow failure does not fall back in enforce or log credential data", async () => {
    mocks.mode = "shadow";
    iam.list.mockRejectedValue(new Error("private policy"));
    expect(await service.listCredentials("actor", request)).toEqual([]);
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("private policy");
    mocks.mode = "enforce";
    await expect(service.listCredentials("actor", request)).rejects.toThrow("private policy");
    expect(credentials.listByUserId).toHaveBeenCalledTimes(1);
  });
  it("legacy checks actual role-session permissions and still rejects credentials belonging to peers", async () => {
    mocks.mode = "legacy";
    request.authContext!.roleSessionId = "session";
    credentials.findByCredentialId.mockResolvedValue({ userId: "peer" });
    await expect(service.deleteCredential("actor", "webauthn-id", request)).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.permission).toHaveBeenCalledWith("actor", expect.any(Array), { assumedRoleSessionId: "session" });
    expect(credentials.deleteByCredentialId).not.toHaveBeenCalled();
  });
});
