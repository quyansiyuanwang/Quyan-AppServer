import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/users/iam-access-key-authority", () => ({ captureIamAccessKeyRevision: vi.fn() }));
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import { env } from "@/config/env";
import { RelayTokenReadIamService } from "@/services/relay/relay-token-read-iam.service";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { relayTokenReadSelect } from "@/store/relay/relay-token-read.repository";
import { relayTokenArn, platformRelayTokenArn } from "@/iam/resources/relay-token-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode;
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() };
const repository = { snapshot: vi.fn(), recheck: vi.fn(), read: vi.fn(), tokenOwner: vi.fn(), assertTargets: vi.fn() };
const permissions = { checkUserPermissions: vi.fn() };
const project = vi.fn(),
  legacy = vi.fn();
const service = new RelayTokenReadIamService(iam, repository, permissions);
const resource = relayTokenArn("owner", "actor", "token");
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "fake:*" },
    secure: true,
  }) as unknown as TypedRequest;
const read = (
  req: TypedRequest | undefined = request(),
  operation: "ListTokens" | "GetToken" | "ExportTokens" = "ListTokens",
  input = {},
) => service.read(operation, "actor", input, req, project, legacy);
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
  repository.snapshot.mockResolvedValue({ users: [] });
  repository.tokenOwner.mockResolvedValue("actor");
  repository.read.mockImplementation(async (_identity, _snapshot, operation, _query, decide, recheck) => {
    const action = "quyan:relay:" + operation;
    const decisions = await decide(action, [resource]);
    await recheck();
    return {
      records: [],
      total: 1,
      page: 1,
      pageSize: 20,
      targets: [],
      evaluations: [{ action, resource, decision: decisions[0] }],
    };
  });
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  project.mockResolvedValue(["fixture-native"]);
  legacy.mockResolvedValue({ items: ["fixture-legacy"], total: 1, page: 1, pageSize: 20 });
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
});
describe("resource-scoped token read contract", () => {
  it("declares fixed server actions on both read routes", () => {
    const source = new Project({ skipAddingFilesFromTsConfig: true });
    source.addSourceFileAtPath("src/api/controllers/v1/relay/relay.controller.ts");
    const routes = collectIamRoutes(source.getSourceFiles(), process.cwd());
    for (const [key, action] of [
      ["GET /v1/relay/tokens", "ListTokens"],
      ["GET /v1/relay/tokens/{id}", "GetToken"],
      ["POST /v1/relay/tokens/export", "ExportTokens"],
    ]) {
      expect(routes.find((row) => row.key === key)).toMatchObject({
        coverage: "explicit",
        actions: ["quyan:relay:" + action],
        issues: [],
      });
    }
    expect(getIamActionDefinition("quyan:relay:RevealToken")).toMatchObject({ resourceTypes: ["relay/token"] });
    expect(getIamActionDefinition("quyan:relay:RevealManagedToken")).toMatchObject({
      authorizationBoundary: "platform",
    });
  });
  it("keeps personal, managed, and unrelated resource types distinct", () => {
    expect(isIamActionResourceCompatible("quyan:relay:GetToken", resource)).toBe(true);
    expect(isIamActionResourceCompatible("quyan:relay:GetToken", platformRelayTokenArn("peer", "token"))).toBe(false);
    expect(isIamActionResourceCompatible("quyan:relay:RevealToken", "acs:quyan:*:owner:user/actor")).toBe(false);
    expect(isIamActionResourceCompatible("quyan:relay:RevealManagedToken", platformUserArn("peer"))).toBe(false);
  });
  it.each(["ListTokens", "GetToken", "RevealToken", "ExportTokens"])(
    "legacy %s does not grant peer or foreign access",
    (operation) => {
      const document = legacyPermissionsToPrincipalPolicy([Permission.RELAY_TOKEN_READ], "owner", "actor")!;
      const decision = (target: string) =>
        evaluatePolicies([{ policyId: "fixture", document }], { action: "quyan:relay:" + operation, resource: target })
          .decision;
      expect(decision(resource)).toBe("Allow");
      expect(decision(relayTokenArn("owner", "peer", "token"))).toBe("ImplicitDeny");
      expect(decision(relayTokenArn("foreign", "actor", "token"))).toBe("ImplicitDeny");
    },
  );
  it("does not select credential-rich user/channel relations", () => {
    expect(relayTokenReadSelect).not.toHaveProperty("token");
    const serialized = JSON.stringify(relayTokenReadSelect);
    expect(serialized).not.toMatch(/password|upstreamApiKey|upstreamUrl|legacyToken|poolMembers/);
    expect(relayTokenReadSelect.user.select).toEqual({ id: true, username: true, name: true });
  });
  it("ignores client action headers and rechecks original proofs after projection", async () => {
    expect((await read()).items).toEqual(["fixture-native"]);
    expect(iam.authorizeMany).toHaveBeenCalledTimes(2);
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:relay:ListTokens", resources: [resource] }),
    );
    expect(repository.assertTargets).toHaveBeenCalledOnce();
    expect(legacy).not.toHaveBeenCalled();
  });
  it("refuses a decision revoked during DTO projection", async () => {
    project.mockImplementation(async () => {
      iam.authorizeMany.mockResolvedValue([{ decision: "ExplicitDeny", reason: "fixture", matchedStatements: [] }]);
      return ["must-not-return"];
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).not.toHaveBeenCalled();
  });
  it("rejects malformed decision batches instead of returning partial data", async () => {
    iam.authorizeMany.mockResolvedValue([]);
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    expect(project).not.toHaveBeenCalled();
  });
  it("requires a trusted principal and forbids delegated subject substitution", async () => {
    await expect(service.read("ListTokens", "actor", {}, undefined, project, legacy)).rejects.toMatchObject({
      statusCode: 403,
    });
    const req = request();
    req.authContext!.principalUserId = "other";
    await expect(read(req)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.read).not.toHaveBeenCalled();
  });
  it("fails closed when policies or target identity change during projection", async () => {
    repository.assertTargets.mockRejectedValue(new Error("fixture changed target"));
    await expect(read()).rejects.toThrow("fixture changed target");
    repository.assertTargets.mockResolvedValue(undefined);
    project.mockImplementation(async () => {
      iam.loadPolicies.mockResolvedValue([
        {
          policyId: "changed",
          document: {
            Version: "1",
            Statement: [{ Effect: "Deny", Action: ["quyan:relay:ListTokens"], Resource: ["*"] }],
          },
        },
      ]);
      return [];
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails closed on AccessKey revocation after projection", async () => {
    const req = request();
    req.authContext!.subjectType = "access_key";
    req.accessKey = { id: "key" } as TypedRequest["accessKey"];
    vi.mocked(captureIamAccessKeyRevision).mockResolvedValue("initial");
    project.mockImplementation(async () => {
      vi.mocked(captureIamAccessKeyRevision).mockResolvedValue("revoked");
      return [];
    });
    await expect(read(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not reinterpret a mutated authenticated request", async () => {
    const req = request();
    project.mockImplementation(async () => {
      req.authContext!.accountOwnerId = "foreign";
      return [];
    });
    await expect(read(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("checks personal admission and the managed target separately", async () => {
    await read(request(), "ListTokens", { targetUserId: "peer" });
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:relay:ListTokens", resources: ["acs:quyan:*:owner:user/actor"] }),
    );
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:relay:ListManagedTokens", resources: [platformUserArn("peer")] }),
    );
  });
  it("denies managed target admission before hydration", async () => {
    iam.authorizeMany.mockImplementation(async ({ action, resources }) =>
      resources.map(() => ({
        decision: action.includes("Managed") ? "ImplicitDeny" : "Allow",
        reason: "fixture",
        matchedStatements: [],
      })),
    );
    await expect(read(request(), "ListTokens", { targetUserId: "peer" })).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.read).not.toHaveBeenCalled();
  });
  it("shadow only previews metadata then runs legacy once", async () => {
    env.security.iamAuthorizationMode = "shadow";
    expect((await read()).items).toEqual(["fixture-legacy"]);
    expect(repository.read.mock.calls[0]![6]).toBe(false);
    expect(project).not.toHaveBeenCalled();
    expect(legacy).toHaveBeenCalledOnce();
  });
  it("legacy avoids native policy reads and still checks its permission ceiling", async () => {
    env.security.iamAuthorizationMode = "legacy";
    await read();
    expect(iam.loadPolicies).not.toHaveBeenCalled();
    expect(legacy).toHaveBeenCalledOnce();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).toHaveBeenCalledOnce();
  });
  it("rejects malformed identifiers and pagination before any data read", async () => {
    await expect(read(request(), "GetToken", { id: "../token" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(read(request(), "ListTokens", { pageSize: 10001 })).rejects.toMatchObject({ statusCode: 400 });
    expect(repository.read).not.toHaveBeenCalled();
  });
  it("applies the same trusted admission, proof and revocation protocol to export", async () => {
    await read(request(), "ExportTokens", { ids: ["token"] });
    expect(iam.authorizeMany).toHaveBeenCalledWith(expect.objectContaining({ action: "quyan:relay:ExportTokens" }));
    await read(request(), "ExportTokens", { targetUserId: "peer", ids: ["token"] });
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:relay:ExportManagedTokens", resources: [platformUserArn("peer")] }),
    );
  });
  it.each([{ ids: [] }, { ids: ["token", "token"] }, { ids: ["../token"] }, { page: 1 }, { id: "token" }])(
    "refuses malformed export selection %j before policy reads",
    async (input) => {
      await expect(read(request(), "ExportTokens", input)).rejects.toMatchObject({ statusCode: 400 });
      expect(iam.loadPolicies).not.toHaveBeenCalled();
    },
  );
});
