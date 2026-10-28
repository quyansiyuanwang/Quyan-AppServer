import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/auth/passkey-management.repository", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    PasskeyManagementRepository: { getInstance: vi.fn() },
    passkeyDenied: () =>
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { PasskeyIamService } from "@/services/auth/passkey-iam.service";
import { getIamActionDefinition, iamActionsForLegacyPermission, Permission } from "@quyan/shared";
import { passkeyArn } from "@/iam/resources/passkey-resources";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import type { TypedRequest } from "@/types/express";
let iam: any, repository: any, service: PasskeyIamService, request: TypedRequest;
const principal = {
  subjectUserId: "actor",
  principalUserId: "actor",
  accountOwnerId: "owner",
  subjectType: "sub_user",
};
const target = (id = "key-z", userId = "actor") => ({ id, userId, createTime: new Date(0), updateTime: new Date(0) });
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
beforeEach(() => {
  vi.clearAllMocks();
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    params: { credentialId: "forged-path" },
    headers: { "x-action": "*", "x-account-id": "foreign" },
    query: { accountId: "foreign", userId: "peer" },
  } as unknown as TypedRequest;
  iam = {
    loadPolicies: vi.fn().mockResolvedValue([]),
    authorizeMany: vi.fn().mockImplementation(async ({ resources }) => resources.map(() => allow)),
  };
  repository = {
    actor: vi.fn().mockResolvedValue({ id: "actor" }),
    scan: vi.fn().mockResolvedValue([target()]),
    hydrate: vi
      .fn()
      .mockImplementation(async (_p, rows) =>
        rows.map((t: { id: string }) => ({ id: t.id, credentialId: "webauthn-id" })),
      ),
    target: vi.fn().mockResolvedValue(target()),
    revoke: vi.fn(),
  };
  service = new (PasskeyIamService as unknown as new (...args: any[]) => PasskeyIamService)(iam, repository);
});
describe("Passkey resource authorization", () => {
  it("registers sensitive native actions without authenticated self or account grants", () => {
    for (const operation of ["GetPasskeyRegistrationOptions", "RegisterPasskey", "ListPasskeys", "DeletePasskey"]) {
      expect(getIamActionDefinition("quyan:auth:" + operation)).toMatchObject({
        sensitive: true,
        authorizationStage: "declared",
        legacyPermission: Permission.PASSKEY_MANAGE,
      });
      expect(getIamActionDefinition("quyan:auth:" + operation)?.defaultAuthorizationScope).toBeUndefined();
      expect(iamActionsForLegacyPermission(Permission.PASSKEY_MANAGE)).toContain("quyan:auth:" + operation);
    }
    expect(getIamActionDefinition("quyan:auth:DeletePasskey")?.resourceTypes).toEqual(["quyan/passkey"]);
  });
  it("registration is scoped to the trusted actual user and account", async () => {
    await service.authorizeRegistration("actor", "quyan:auth:RegisterPasskey", request);
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        principal,
        action: "quyan:auth:RegisterPasskey",
        resources: ["acs:quyan:*:owner:user/actor"],
      }),
    );
  });
  it("uses persisted record IDs rather than request action, user or WebAuthn IDs", async () => {
    await service.revoke("actor", "actual-authenticator", request);
    expect(repository.target).toHaveBeenCalledWith(principal, "actual-authenticator");
    expect(iam.authorizeMany).toHaveBeenCalledTimes(2);
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:auth:DeletePasskey",
        resources: ["acs:quyan:*:owner:passkey/actor/key-z"],
      }),
    );
    expect(repository.revoke).toHaveBeenCalledWith(principal, target());
    expect(auditIamDecision).toHaveBeenCalledWith(expect.objectContaining({ authorizationMode: "enforce" }));
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])("blocks %s without mutation", async (decision) => {
    iam.authorizeMany.mockResolvedValue([{ ...allow, decision }]);
    await expect(service.revoke("actor", "webauthn-id", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.revoke).not.toHaveBeenCalled();
    await expect(service.authorizeRegistration("actor", "quyan:auth:RegisterPasskey", request)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("blocks policy revocation immediately before deletion", async () => {
    iam.authorizeMany.mockResolvedValueOnce([allow]).mockResolvedValueOnce([{ ...allow, decision: "ExplicitDeny" }]);
    await expect(service.revoke("actor", "webauthn-id", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.revoke).not.toHaveBeenCalled();
  });
  it("diagnostic shadow authorization does not revoke credentials", async () => {
    await service.authorizeDeletion("actor", "webauthn-id", request);
    expect(repository.revoke).not.toHaveBeenCalled();
  });
  it("filters unauthorized rows before hydrating public credential metadata", async () => {
    repository.scan.mockResolvedValue([target("key-z"), target("key-a")]);
    iam.authorizeMany.mockResolvedValueOnce([allow, { ...allow, decision: "ExplicitDeny" }]);
    expect(await service.list("actor", request)).toEqual([{ id: "key-z", credentialId: "webauthn-id" }]);
    expect(repository.hydrate).toHaveBeenCalledWith(principal, [target("key-z")]);
  });
  it("returns an empty collection without loading denied credential metadata", async () => {
    iam.authorizeMany.mockResolvedValue([{ ...allow, decision: "ImplicitDeny" }]);
    expect(await service.list("actor", request)).toEqual([]);
    expect(repository.hydrate).toHaveBeenCalledWith(principal, []);
  });
  it("rechecks authorization after hydration and before returning", async () => {
    iam.authorizeMany.mockResolvedValueOnce([allow]).mockResolvedValue([{ ...allow, decision: "ExplicitDeny" }]);
    expect(await service.list("actor", request)).toEqual([]);
  });
  it("rechecks previously hydrated rows at the end of the response", async () => {
    iam.authorizeMany
      .mockResolvedValueOnce([allow])
      .mockResolvedValueOnce([allow])
      .mockResolvedValueOnce([{ ...allow, decision: "ExplicitDeny" }]);
    expect(await service.list("actor", request)).toEqual([]);
  });
  it("fails closed with unavailable authorization data before resource lookup", async () => {
    iam.loadPolicies.mockRejectedValue(new Error("fixture unavailable"));
    await expect(service.revoke("actor", "webauthn-id", request)).rejects.toThrow("fixture unavailable");
    expect(repository.target).not.toHaveBeenCalled();
  });
  it("rejects missing context or a different service user before any lookup", async () => {
    await expect(service.list("actor")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.list("peer", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.actor).not.toHaveBeenCalled();
  });
  it.each([null, { ...target(), userId: "peer" }, { ...target(), id: "bad/id" }])(
    "rejects unavailable or misbound repository target",
    async (row) => {
      repository.target.mockResolvedValue(row);
      await expect(service.revoke("actor", "webauthn-id", request)).rejects.toMatchObject({ statusCode: 403 });
      expect(repository.revoke).not.toHaveBeenCalled();
    },
  );
  it.each([" key", "key/child", "key:*", "", "x".repeat(2049)])("rejects malformed WebAuthn path ID", async (id) => {
    await expect(service.revoke("actor", id, request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.target).not.toHaveBeenCalled();
  });
  it.each([{ results: [] }, { results: [undefined] }, { results: undefined }])(
    "rejects incomplete IAM decisions",
    async ({ results }) => {
      iam.authorizeMany.mockResolvedValue(results);
      await expect(service.list("actor", request)).rejects.toMatchObject({ statusCode: 403 });
      expect(repository.hydrate).not.toHaveBeenCalled();
    },
  );
  it("rejects unexpected hydration rows and cross-user scan metadata", async () => {
    repository.hydrate.mockResolvedValue([{ id: "unexpected" }]);
    await expect(service.list("actor", request)).rejects.toMatchObject({ statusCode: 403 });
    repository.scan.mockResolvedValue([target("key-z", "peer")]);
    await expect(service.list("actor", request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects out-of-order scan metadata", async () => {
    repository.scan.mockResolvedValue([target("key-a"), target("key-z")]);
    await expect(service.list("actor", request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects wildcard, slash or whitespace ARN identities", () => {
    for (const id of ["*", "key/child", " key"]) expect(() => passkeyArn("owner", "actor", id)).toThrow();
  });
});
