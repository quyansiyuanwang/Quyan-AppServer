vi.mock("@/util/auth-session", () => ({ buildForceOfflineUserKey: (id: string) => "fixture-offline:" + id }));
vi.mock("@/services/infrastructure/redis.service", () => ({
  RedisService: { getInstance: () => ({ get: vi.fn().mockResolvedValue(null) }) },
}));
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { ImpersonationIamService } from "@/services/users/impersonation-iam.service";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import type { TypedRequest } from "@/types/express";
import type { ImpersonationSnapshot } from "@/store/users/impersonation-iam.store";
import type { JWTPayload } from "@/util/auth";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  repository = { snapshot: vi.fn(), guarded: vi.fn() },
  service = new ImpersonationIamService(iam, repository),
  act = "quyan:user:StartActImpersonation",
  view = "quyan:user:StartViewImpersonation";
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": view, "x-account-id": "forged" },
    secure: true,
    ip: "192.0.2.20",
  }) as unknown as TypedRequest;
const snapshot = () =>
  ({
    actor: { id: "actor", updateTime: new Date(0) },
    target: { id: "target", updateTime: new Date(0) },
    revision: "a".repeat(64),
    authorizationRevision: "b".repeat(64),
    canAct: true,
    canView: true,
  }) as ImpersonationSnapshot;
const payload = (): JWTPayload => ({
  userId: "target",
  updatedAt: new Date(0).toISOString(),
  impersonatorId: "actor",
  impersonationMode: "act",
  impersonationIssuer: {
    principal: { subjectUserId: "actor", principalUserId: "actor", accountOwnerId: "owner", subjectType: "sub_user" },
    updatedAt: new Date(0).toISOString(),
  },
});
const decision = (value = "Allow") => [{ decision: value, reason: "fixture", matchedStatements: [] }];
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockResolvedValue(decision());
  repository.snapshot.mockResolvedValue(snapshot());
  repository.guarded.mockImplementation(async (_principal, _id, expected, recheck) => {
    await recheck();
    return expected;
  });
});
describe("live impersonation IAM authority", () => {
  it("prefers authorized act on the real target and signs original issuer provenance", async () => {
    const result = await service.start("actor", "target", request());
    expect(result).toMatchObject({ mode: "act", issuer: payload().impersonationIssuer });
    for (const [input] of iam.authorizeMany.mock.calls)
      expect(input).toMatchObject({
        action: act,
        resources: [platformUserArn("target")],
        principal: { accountOwnerId: "owner" },
      });
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])(
    "falls back to separately authorized view after %s on act",
    async (denied) => {
      iam.authorizeMany.mockImplementation(async ({ action }) => decision(action === act ? denied : "Allow"));
      expect((await service.start("actor", "target", request())).mode).toBe("view");
    },
  );
  it("does not manufacture act eligibility from a policy", async () => {
    repository.snapshot.mockResolvedValue({ ...snapshot(), canAct: false });
    expect((await service.start("actor", "target", request())).mode).toBe("view");
    expect(iam.authorizeMany.mock.calls.every(([input]) => input.action === view)).toBe(true);
  });
  it("never converts an act Allow into a view Allow", async () => {
    repository.snapshot.mockResolvedValue({ ...snapshot(), canAct: false });
    iam.authorizeMany.mockImplementation(async ({ action }) => decision(action === act ? "Allow" : "ImplicitDeny"));
    await expect(service.start("actor", "target", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])("does not issue after both modes return %s", async (denied) => {
    iam.authorizeMany.mockResolvedValue(decision(denied));
    await expect(service.start("actor", "target", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.guarded).not.toHaveBeenCalled();
  });
  it.each([[], [null], decision("invalid"), [...decision(), ...decision()]].map((results) => ({ results })))(
    "rejects malformed or incomplete decisions %j",
    async ({ results }) => {
      iam.authorizeMany.mockResolvedValue(results);
      await expect(service.start("actor", "target", request())).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("does not treat policy unavailability as a reason to downgrade", async () => {
    iam.authorizeMany.mockRejectedValue(new Error("unavailable"));
    await expect(service.start("actor", "target", request())).rejects.toThrow("unavailable");
    expect(iam.authorizeMany).toHaveBeenCalledTimes(1);
  });
  it("rechecks conditions at the signing boundary", async () => {
    iam.authorizeMany.mockResolvedValueOnce(decision()).mockResolvedValue(decision("ExplicitDeny"));
    await expect(service.start("actor", "target", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects changed policy bindings before returning a signing grant", async () => {
    iam.loadPolicies
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { policyId: "new", document: { Version: "1", Statement: { Effect: "Deny", Action: act, Resource: "*" } } },
      ]);
    await expect(service.start("actor", "target", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("propagates persisted identity and group conflicts", async () => {
    repository.guarded.mockRejectedValue(new Error("snapshot changed"));
    await expect(service.start("actor", "target", request())).rejects.toThrow("snapshot changed");
  });
  it("blocks missing identity, mismatched actor, self, malformed target, nested and OAuth starts", async () => {
    await expect(service.start("actor", "target")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.start("other", "target", request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.start("actor", "actor", request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.start("actor", "target/*", request())).rejects.toMatchObject({ statusCode: 403 });
    for (const extra of [
      { user: { userId: "actor", impersonatorId: "previous" } },
      { oauthAccessToken: { id: "oauth" } },
      { authContext: undefined },
    ])
      await expect(service.start("actor", "target", { ...request(), ...extra } as TypedRequest)).rejects.toMatchObject({
        statusCode: 403,
      });
  });
  it("retains a role session and uses the authenticated session rather than body input", async () => {
    const req = request();
    req.authContext!.roleSessionId = "session";
    req.authContext!.assumedRoleId = "role";
    expect((await service.start("actor", "target", req)).issuer.principal).toMatchObject({
      subjectType: "assumed_role",
      roleSessionId: "session",
      assumedRoleId: "role",
    });
  });
  it("retains only the credential identifier for AccessKey revalidation", async () => {
    const req = request();
    req.authContext!.subjectType = "access_key";
    req.accessKey = { id: "key", key: "fixture-secret" } as never;
    const result = await service.start("actor", "target", req);
    expect(result.issuer).toMatchObject({ accessKeyId: "key", principal: { subjectType: "access_key" } });
    expect(JSON.stringify(result.issuer)).not.toContain("fixture-secret");
  });
  it("revalidates the issuer and the exact mode for a signed session", async () => {
    await service.validateSession(payload(), request());
    expect(repository.snapshot).toHaveBeenCalledWith(payload().impersonationIssuer!.principal, "target", undefined);
  });
  it("does not downgrade an existing act token when act is revoked", async () => {
    iam.authorizeMany.mockImplementation(async ({ action }) => decision(action === act ? "ExplicitDeny" : "Allow"));
    await expect(service.validateSession(payload(), request())).rejects.toMatchObject({ statusCode: 403 });
    expect(iam.authorizeMany).toHaveBeenCalledTimes(1);
  });
  it("does not upgrade a view session when act becomes available", async () => {
    const token = payload();
    token.impersonationMode = "view";
    await service.validateSession(token, request());
    expect(iam.authorizeMany.mock.calls.every(([input]) => input.action === view)).toBe(true);
  });
  it("rejects an issuer whose profile/token revision changed", async () => {
    const token = payload();
    token.impersonationIssuer!.updatedAt = new Date(1).toISOString();
    await expect(service.validateSession(token, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(iam.loadPolicies).not.toHaveBeenCalled();
  });
  it.each(["missing", "actor", "owner", "mode", "type"])("rejects incomplete issuer provenance: %s", async (kind) => {
    const token = payload();
    if (kind === "missing") token.impersonationIssuer = undefined;
    if (kind === "actor") token.impersonationIssuer!.principal.subjectUserId = "forged";
    if (kind === "owner") token.impersonationIssuer!.principal.accountOwnerId = "*";
    if (kind === "mode") token.impersonationMode = "invalid" as never;
    if (kind === "type") token.impersonationIssuer!.principal.subjectType = "invalid" as never;
    await expect(service.validateSession(token, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"])("preserves session behavior in %s rollback mode", async (mode) => {
    env.security.iamAuthorizationMode = mode as never;
    await service.validateSession({ ...payload(), impersonationIssuer: undefined }, request());
    expect(repository.snapshot).not.toHaveBeenCalled();
  });
  it("fails closed for an unsupported session authorization mode", async () => {
    env.security.iamAuthorizationMode = "invalid" as never;
    await expect(service.validateSession(payload(), request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("registers two immutable target-resource actions on the start endpoint", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true }),
      file = project.addSourceFileAtPath("src/api/controllers/v1/users/impersonation.controller.ts");
    expect(collectIamRoutes([file], process.cwd()).find((row) => row.method === "startImpersonation")).toMatchObject({
      coverage: "explicit",
      actions: [act, view],
      resourceKind: "single-resource",
    });
  });
});
