import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { PlatformRedemptionCodeWriteIamService } from "@/services/billing/platform-redemption-code-write-iam.service";
import {
  platformRedemptionCodeArn,
  platformRedemptionCodeCollectionArn,
} from "@/iam/resources/platform-redemption-code-resources";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  repository = { authorizationRevision: vi.fn(), target: vi.fn(), create: vi.fn(), remove: vi.fn() },
  identities = { snapshot: vi.fn(), recheck: vi.fn() };
const service = new PlatformRedemptionCodeWriteIamService(iam, repository, identities);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    secure: true,
    headers: { "x-action": "*" },
    ip: "192.0.2.1",
  }) as unknown as TypedRequest;
const target = () => ({
  id: "code-id",
  status: 1,
  createTime: new Date(0),
  updateTime: new Date(0),
  revision: "a".repeat(64),
});
const row = () => ({
  ...target(),
  code: "fixture-only",
  amount: 10,
  createdBy: "actor",
  usedBy: null,
  usedAt: null,
  expiresAt: null,
});
let denied: Set<string>;
beforeEach(() => {
  vi.resetAllMocks();
  denied = new Set();
  iam.loadPolicies.mockResolvedValue([]);
  repository.authorizationRevision.mockResolvedValue("a".repeat(64));
  iam.authorizeMany.mockImplementation(async ({ resources }: { resources: string[] }) =>
    resources.map((resource) => ({
      decision: denied.has(resource) ? "ExplicitDeny" : "Allow",
      reason: "fixture",
      matchedStatements: [],
    })),
  );
  identities.snapshot.mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] });
  identities.recheck.mockResolvedValue(undefined);
  repository.target.mockResolvedValue(target());
  repository.create.mockImplementation(async (_input, guard) => {
    await guard.users.recheck();
    await guard.recheckEntries(["new-code"]);
    return [row()];
  });
  repository.remove.mockImplementation(async (_target, guard) => {
    await guard.users.recheck();
    await guard.recheckEntries(["code-id"]);
    return row();
  });
});
describe("platform redemption writes", () => {
  it("requires creation collection and new record access", async () => {
    expect(await service.create({ amount: 10 }, "actor", request())).toHaveLength(1);
    expect(iam.authorizeMany.mock.calls.every(([input]) => input.action === "quyan:redemption_code:CreateCodes")).toBe(
      true,
    );
    expect(
      iam.authorizeMany.mock.calls.some(([input]) => input.resources.includes(platformRedemptionCodeArn("new-code"))),
    ).toBe(true);
  });
  it("rejects collection Deny before any write", async () => {
    denied.add(platformRedemptionCodeCollectionArn());
    await expect(service.create({ amount: 10 }, "actor", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.create).not.toHaveBeenCalled();
  });
  it("rejects record Deny in the write guard", async () => {
    denied.add(platformRedemptionCodeArn("new-code"));
    await expect(service.create({ amount: 10 }, "actor", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses the trusted loaded delete identity and resource", async () => {
    await service.remove("code-id", "actor", request());
    expect(repository.remove.mock.calls[0]![0]).toMatchObject({ id: "code-id", revision: "a".repeat(64) });
    expect(
      iam.authorizeMany.mock.calls.every(
        ([input]) =>
          input.action === "quyan:redemption_code:DeleteCode" &&
          input.resources[0] === platformRedemptionCodeArn("code-id"),
      ),
    ).toBe(true);
  });
  it("does not grant delete from a creation or read action", async () => {
    denied.add(platformRedemptionCodeArn("code-id"));
    await expect(service.remove("code-id", "actor", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.remove).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    null,
    { ...target(), id: "other" },
    { ...target(), status: 0 },
    { ...target(), revision: "bad" },
  ])("rejects missing or altered delete target %#", async (value) => {
    repository.target.mockResolvedValue(value);
    await expect(service.remove("code-id", "actor", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.remove).not.toHaveBeenCalled();
  });
  it.each([
    { amount: 0 },
    { amount: NaN },
    { amount: 100001 },
    { amount: 10, count: 1001 },
    { amount: 10, count: 0 },
    { amount: 10, count: 1.5 },
    { amount: 10, expiresAt: new Date(0) },
  ])("validates create input outside HTTP %j", async (input) => {
    await expect(service.create(input, "actor", request())).rejects.toMatchObject({ statusCode: 400 });
    expect(repository.create).not.toHaveBeenCalled();
  });
  it.each(["missing", "actor", "oauth", "impersonation"])("rejects invalid %s principal", async (kind) => {
    const req = request();
    if (kind === "missing") delete req.user;
    if (kind === "actor") req.user!.userId = "other";
    if (kind === "oauth") req.oauthAccessToken = {} as never;
    if (kind === "impersonation") req.authContext!.principalUserId = "other";
    await expect(service.create({ amount: 10 }, "actor", req)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.create).not.toHaveBeenCalled();
  });
  it("rechecks authorization revision before commit", async () => {
    repository.authorizationRevision.mockResolvedValueOnce("a".repeat(64)).mockResolvedValue("b".repeat(64));
    await expect(service.create({ amount: 10 }, "actor", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects malformed evaluator results", async () => {
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.create({ amount: 10 }, "actor", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not write while evaluating shadow paths", async () => {
    await service.create({ amount: 10 }, "actor", request(), false);
    await service.remove("code-id", "actor", request(), false);
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.remove).not.toHaveBeenCalled();
  });
  it("simulates actual legacy-issued resources without issuing a second batch", async () => {
    await service.simulateIssued(["new-code"], "actor", request());
    expect(
      iam.authorizeMany.mock.calls.some(([input]) => input.resources.includes(platformRedemptionCodeArn("new-code"))),
    ).toBe(true);
    expect(repository.create).not.toHaveBeenCalled();
  });
  it("rejects unsafe delete identifiers before loading resources", async () => {
    await expect(service.remove("bad/id", "actor", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.target).not.toHaveBeenCalled();
  });
  it("retains replay and two-factor guards while defining fixed write actions", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const source = project.addSourceFileAtPath("src/api/controllers/v1/billing/redemption-code.controller.ts");
    const routes = collectIamRoutes([source], process.cwd());
    expect(routes.find((r) => r.method === "createCodes")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:redemption_code:CreateCodes"],
      resourceKind: "batch",
    });
    expect(routes.find((r) => r.method === "deleteCode")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:redemption_code:DeleteCode"],
      resourceKind: "single-resource",
    });
    for (const method of ["createCodes", "deleteCode"]) {
      const text = source.getClassOrThrow("RedemptionCodeController").getMethodOrThrow(method).getText();
      expect(text).toContain("twoFactorChallengeMiddleware");
      expect(text).toContain("replayProtectionMiddleware");
    }
  });
});
