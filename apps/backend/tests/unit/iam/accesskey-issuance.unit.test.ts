import { beforeEach, describe, expect, it, vi } from "vitest";
import { getIamActionDefinition, iamActionsForLegacyPermission, Permission } from "@quyan/shared";
import {
  accessKeyIssuanceSnapshotMiddleware,
  accessKeyIssuanceReadyMiddleware,
  getAccessKeyIssuanceState,
} from "@/iam/request/accesskey-issuance-context";
import { AccessKeyIamService } from "@/services/users/accesskey-iam.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import type { TypedRequest } from "@/types/express";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service");
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
const principal = {
  subjectUserId: "actor",
  principalUserId: "actor",
  accountOwnerId: "owner",
  subjectType: "sub_user" as const,
};
let req: TypedRequest, repository: any, iam: any, service: AccessKeyIamService;
beforeEach(() => {
  vi.clearAllMocks();
  req = {
    user: { userId: "actor" },
    authContext: { ...principal, principalUserId: "actor" },
    params: { id: "forged" },
    query: { userId: "peer", accountOwnerId: "foreign" },
    headers: { "x-action": "*" },
    ip: "127.0.0.1",
    secure: true,
  } as unknown as TypedRequest;
  repository = {
    captureIssuance: vi.fn().mockImplementation(async (principal: object, oauth: object) => ({
      principal: { ...principal },
      snapshot: {
        id: "actor",
        email: "fixture@example.test",
        twoFactorEnabled: false,
        twoFactorPasskeyRequired: false,
        accountOwnerId: "owner",
        status: 1,
        revision: "2026-10-01T00:00:00.000Z",
      },
      ...(oauth ? { oauth: { ...oauth } } : {}),
    })),
    checkIssuanceState: vi.fn().mockResolvedValue(undefined),
  };
  iam = {
    loadPolicies: vi.fn().mockResolvedValue([]),
    authorize: vi.fn().mockResolvedValue({ decision: "Allow", reason: "matched-allow", matchedStatements: [] }),
  };
  service = new (AccessKeyIamService as any)(iam, repository);
});
async function capture() {
  await new Promise<void>((resolve, reject) => {
    void accessKeyIssuanceSnapshotMiddleware(repository)(req, {} as never, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}
async function ready() {
  await capture();
  accessKeyIssuanceReadyMiddleware(req, {} as never, (error) => {
    if (error) throw error;
  });
}
describe("native access-key creation boundary and server-only step-up snapshot", () => {
  it.each(["CreateAccessKey", "SendAccessKeyCreationVerificationCode"])(
    "registers %s without a default self grant",
    (operation) => {
      const action = "quyan:ram:" + operation;
      expect(getIamActionDefinition(action)).toMatchObject({
        sensitive: true,
        resourceTypes: ["quyan/user"],
        authorizationStage: "declared",
      });
      expect(getIamActionDefinition(action)).not.toHaveProperty("defaultAuthorizationScope");
      expect(iamActionsForLegacyPermission(Permission.ACCESSKEY_CREATE)).toContain(action);
    },
  );
  it("requires both snapshot capture and completion of the server guard chain", async () => {
    expect(() => getAccessKeyIssuanceState(req)).toThrow();
    (req as any).accessKeyIssuanceState = { principal, ready: true };
    await capture();
    expect(() => getAccessKeyIssuanceState(req)).toThrow();
    accessKeyIssuanceReadyMiddleware(req, {} as never, vi.fn());
    expect(getAccessKeyIssuanceState(req).snapshot.id).toBe("actor");
    expect(Object.isFrozen(getAccessKeyIssuanceState(req).snapshot)).toBe(true);
  });
  it("rejects completion without a snapshot and changes to trusted identity afterwards", async () => {
    const next = vi.fn();
    accessKeyIssuanceReadyMiddleware(req, {} as never, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    await ready();
    req.authContext!.accountOwnerId = "foreign";
    expect(() => getAccessKeyIssuanceState(req)).toThrow();
  });
  it.each(["quyan:ram:CreateAccessKey", "quyan:ram:SendAccessKeyCreationVerificationCode"] as const)(
    "authorizes %s from actual actor not client inputs",
    async (action) => {
      await ready();
      await service.authorizeIssuance("actor", action, req);
      expect(iam.authorize).toHaveBeenCalledWith(
        expect.objectContaining({ principal, action, resource: "acs:quyan:*:owner:user/actor" }),
      );
      const audit = JSON.stringify(vi.mocked(auditIamDecision).mock.calls);
      expect(audit).not.toContain("fixture@example.test");
      expect(audit).not.toContain("2026-10-01");
    },
  );
  it("rejects peer service arguments and explicit Deny", async () => {
    await ready();
    await expect(service.authorizeIssuance("peer", "quyan:ram:CreateAccessKey", req)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(iam.authorize).not.toHaveBeenCalled();
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] });
    await expect(service.authorizeIssuance("actor", "quyan:ram:CreateAccessKey", req)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("fails closed on snapshot or policy-storage errors", async () => {
    await ready();
    repository.checkIssuanceState.mockRejectedValue(new Error("fixture storage failure"));
    await expect(service.authorizeIssuance("actor", "quyan:ram:CreateAccessKey", req)).rejects.toThrow();
    expect(iam.authorize).not.toHaveBeenCalled();
  });
  it("retains OAuth creation only with exact executing-user scope and live metadata capture", async () => {
    req.oauthAccessToken = {
      id: "oauth-id",
      oauthClientId: "client-id",
      clientId: "fixture-client",
      clientName: "fixture",
      userId: "actor",
      scopes: ["accesskey"],
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };
    await ready();
    await service.authorizeIssuance("actor", "quyan:ram:CreateAccessKey", req);
    expect(repository.captureIssuance).toHaveBeenCalledWith(principal, { id: "oauth-id", clientId: "client-id" });
    req.oauthAccessToken.scopes = [];
    expect(() => getAccessKeyIssuanceState(req)).toThrow();
  });
  it("rejects expired or foreign-user OAuth before capturing state", async () => {
    req.oauthAccessToken = {
      id: "oauth-id",
      oauthClientId: "client-id",
      userId: "peer",
      scopes: ["accesskey"],
      expiresAt: new Date(0).toISOString(),
    } as never;
    await expect(capture()).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.captureIssuance).not.toHaveBeenCalled();
  });
});
