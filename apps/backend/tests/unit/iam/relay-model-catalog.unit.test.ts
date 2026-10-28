import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/users/iam-access-key-authority", () => ({ captureIamAccessKeyRevision: vi.fn() }));
vi.mock("@/store/users/iam-oauth-authority", () => ({ captureIamOAuthRevision: vi.fn() }));
import { Project } from "ts-morph";
import { getIamActionDefinition, isIamActionResourceCompatible, Permission } from "@quyan/shared";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { env } from "@/config/env";
import { RelayModelCatalogReadIamService } from "@/services/relay/relay-model-catalog-read-iam.service";
import { relayModelCatalogArn } from "@/iam/resources/relay-model-catalog-resources";
import { platformModelPricingArn } from "@/iam/resources/platform-model-pricing-resources";
import { captureIamOAuthRevision } from "@/store/users/iam-oauth-authority";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  action = "quyan:relay:ListAvailableModels";
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  repository = { snapshot: vi.fn(), scan: vi.fn(), hydrate: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  project = vi.fn(),
  legacy = vi.fn();
const service = new RelayModelCatalogReadIamService(iam, repository, permissions);
const target = { id: "record", status: 1, createTime: new Date(0), updateTime: new Date(0) },
  entry = { ...target, model: "visible", provider: "public-id" };
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "fake:*" },
    secure: true,
  }) as unknown as TypedRequest;
const read = (req: TypedRequest | undefined = request()) => service.read("actor", req, project, legacy);
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
  repository.snapshot.mockResolvedValue({ users: [], group: null });
  repository.scan.mockResolvedValue([target]);
  repository.hydrate.mockResolvedValue([entry]);
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  project.mockResolvedValue({ modelNames: ["visible"] });
  legacy.mockResolvedValue({ modelNames: ["legacy"] });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("account-scoped public model discovery authorization", () => {
  it("registers a distinct discovery resource, not a platform pricing control", () => {
    expect(getIamActionDefinition(action)).toMatchObject({
      resourceTypes: ["relay/model-catalog-entry"],
      legacyPermission: Permission.RELAY_TOKEN_READ,
      sensitive: false,
      authorizationStage: "declared",
    });
    expect(getIamActionDefinition(action)?.authorizationBoundary).toBeUndefined();
    expect(isIamActionResourceCompatible(action, relayModelCatalogArn("owner", "record"))).toBe(true);
    expect(isIamActionResourceCompatible(action, platformModelPricingArn("record"))).toBe(false);
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "GET /v1/relay/available-models",
      ),
    ).toMatchObject({ coverage: "explicit", actions: [action], issues: [] });
  });
  it("uses server-owned Action and account owner despite forged client headers", async () => {
    await read();
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ action, resources: [relayModelCatalogArn("owner", "record")] }),
    );
    expect(project).toHaveBeenCalledWith(
      [entry],
      expect.objectContaining({ subjectUserId: "actor", accountOwnerId: "owner" }),
    );
  });
  it("never reads denied model names", async () => {
    iam.authorizeMany.mockResolvedValue([{ decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] }]);
    await read();
    expect(repository.hydrate).not.toHaveBeenCalled();
    expect(project).toHaveBeenCalledWith([], expect.any(Object));
  });
  it("passes a copy of the trusted identity to projections", async () => {
    project.mockImplementation(async (_rows, identity) => {
      identity.accountOwnerId = "foreign";
      return { modelNames: ["visible"] };
    });
    expect(await read()).toEqual({ modelNames: ["visible"] });
    expect(iam.authorizeMany.mock.calls.every(([input]) => input.principal.accountOwnerId === "owner")).toBe(true);
  });
  it("rechecks an asynchronous request binding before the first data scan", async () => {
    const req = request();
    repository.snapshot.mockImplementation(async () => {
      req.authContext!.accountOwnerId = "foreign";
      return { users: [], group: null };
    });
    await expect(read(req)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.scan).not.toHaveBeenCalled();
  });
  it("rechecks decisions after the projection", async () => {
    project.mockImplementation(async () => {
      iam.authorizeMany.mockResolvedValue([
        { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] },
      ]);
      return { modelNames: ["visible"] };
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).not.toHaveBeenCalled();
  });
  it("discards output if a projected alias no longer matches storage", async () => {
    repository.hydrate.mockResolvedValueOnce([entry]).mockResolvedValueOnce([{ ...entry, provider: "changed" }]);
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails closed for malformed evaluator results", async () => {
    iam.authorizeMany.mockResolvedValue([]);
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    expect(project).not.toHaveBeenCalled();
  });
  it("validates the original channel READ OAuth scope on persisted records", async () => {
    const req = {
      ...request(),
      oauthAccessToken: { id: "oauth", oauthClientId: "client", userId: "actor", scopes: ["*"] },
    } as TypedRequest;
    await read(req);
    expect(captureIamOAuthRevision).toHaveBeenCalledWith(
      expect.objectContaining({ subjectUserId: "actor" }),
      { id: "oauth", clientId: "client" },
      ["relay:channel:read"],
    );
  });
  it.each(["legacy", "shadow"] as const)("preserves original Token READ admission in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).not.toHaveBeenCalled();
  });
  it("shadow does not hydrate public labels or invoke the native projection", async () => {
    env.security.iamAuthorizationMode = "shadow";
    expect(await read()).toEqual({ modelNames: ["legacy"] });
    expect(repository.hydrate).not.toHaveBeenCalled();
    expect(project).not.toHaveBeenCalled();
    expect(legacy).toHaveBeenCalledTimes(1);
  });
  it("does not treat an unknown rollout mode as legacy", async () => {
    env.security.iamAuthorizationMode = "unexpected" as typeof mode;
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).not.toHaveBeenCalled();
  });
  it("never uses legacy after a policy loading failure in enforce", async () => {
    iam.loadPolicies.mockRejectedValue(new Error("fixture failure"));
    await expect(read()).rejects.toThrow("fixture failure");
    expect(legacy).not.toHaveBeenCalled();
  });
});
