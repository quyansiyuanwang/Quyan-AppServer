import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { PlatformRelayProbeAccountCreateIamService } from "@/services/relay/platform-relay-probe-account-create-iam.service";
import {
  platformRelayProbeAccountArn,
  platformRelayProbeAccountControlArn,
} from "@/iam/resources/platform-relay-probe-resources";
import { platformRelayProbeAccountCreateResourceResolver } from "@/iam/request/relay-probe-resource-resolvers";
import { getIamActionDefinition, Permission } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode,
  iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  repository = { create: vi.fn() },
  identities = { snapshot: vi.fn(), recheck: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  allocateId = vi.fn(),
  encrypt = vi.fn(),
  legacy = vi.fn(),
  service = new PlatformRelayProbeAccountCreateIamService(iam, repository, identities, permissions, allocateId);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "fake:*" },
    params: { accountId: "target" },
    secure: true,
  }) as unknown as TypedRequest;
const input = {
  name: "fixture-updated",
  loginWorkflow: { method: "POST" as const, url: "https://example.com/login" },
  tokenPath: "data.token",
  fallbackTtlSeconds: 300,
  minLoginIntervalSeconds: 60,
  credentials: { username: "fixture", password: "fixture-secret" },
};
const row = {
  id: "target",
  name: "fixture-updated",
  tokenPath: "data.token",
  expiresPath: null,
  expiresMode: null,
  fallbackTtlSeconds: 300,
  minLoginIntervalSeconds: 60,
  lastLoginAttemptAt: null,
  updateTime: new Date(0),
  hasCredentials: true,
};
const create = () => service.create(input, encrypt, request(), legacy);
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
  identities.snapshot.mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] });
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  allocateId.mockReturnValue("target");
  legacy.mockResolvedValue({ ...row, cached: false });
  repository.create.mockImplementation(async (_id, _input, _principal, _snapshot, recheck, _encrypt, persist) => {
    await recheck();
    return persist ? row : undefined;
  });
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
});
describe("probe account creation against reserved resources", () => {
  it("declares the control resource and future account resource", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel-probe.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "POST /v1/relay-channel-probes/accounts",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:CreateProbeAccount"], issues: [] });
    expect(getIamActionDefinition("quyan:relay:CreateProbeAccount")).toMatchObject({
      authorizationBoundary: "platform",
      resourceTypes: ["platform/relay-probe-account-control", "platform/relay-probe-account"],
      legacyPermission: Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE,
    });
  });
  it("resolves the server-owned creation control resource", async () => {
    expect(
      await platformRelayProbeAccountCreateResourceResolver({
        request: request(),
        principal: {
          subjectUserId: "actor",
          principalUserId: "actor",
          accountOwnerId: "owner",
          subjectType: "sub_user",
        },
      }),
    ).toBe(platformRelayProbeAccountControlArn());
  });
  it("evaluates both resources before passing credentials to the repository", async () => {
    expect(await create()).toMatchObject({ id: "target", hasCredentials: true, cached: false });
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:relay:CreateProbeAccount",
        resources: [platformRelayProbeAccountControlArn(), platformRelayProbeAccountArn("target")],
      }),
    );
    expect(repository.create.mock.calls[0]?.[0]).toBe("target");
    expect(repository.create.mock.calls[0]?.[6]).toBe(true);
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each([0, 1])("blocks a deny on resource index %s before persisting", async (index) => {
    iam.authorizeMany.mockResolvedValue(
      [0, 1].map((position) => ({
        decision: position === index ? "ExplicitDeny" : "Allow",
        reason: "fixture",
        matchedStatements: [],
      })),
    );
    await expect(create()).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.create).not.toHaveBeenCalled();
    expect(encrypt).not.toHaveBeenCalled();
  });
  it("requires authoritative platform membership", async () => {
    identities.snapshot.mockRejectedValue(new Error("fixture revoked"));
    await expect(create()).rejects.toThrow();
    expect(repository.create).not.toHaveBeenCalled();
  });
  it("fails closed on a malformed or incomplete decision batch", async () => {
    iam.authorizeMany.mockResolvedValue([{ decision: "Allow", reason: "fixture", matchedStatements: [] }]);
    await expect(create()).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.create).not.toHaveBeenCalled();
  });
  it("fails closed when policies change during the commit", async () => {
    iam.loadPolicies
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        {
          policyId: "changed",
          document: {
            Version: "1",
            Statement: { Effect: "Deny", Action: "quyan:relay:CreateProbeAccount", Resource: "*" },
          },
        },
      ]);
    await expect(create()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each([undefined, "delegated", "oauth"])("rejects untrusted identity context %s", async (kind) => {
    const req = kind === undefined ? undefined : request();
    if (kind === "delegated") req!.authContext!.principalUserId = "issuer";
    if (kind === "oauth") req!.oauthAccessToken = {} as TypedRequest["oauthAccessToken"];
    await expect(service.create(input, encrypt, req, legacy)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.create).not.toHaveBeenCalled();
  });
  it.each([
    { ...input, credentials: undefined },
    { ...input, credentials: { accountToken: "forbidden" } },
    { ...input, tokenPath: "" },
  ])("requires valid credentials and configuration", async (invalid) => {
    await expect(service.create(invalid, encrypt, request(), legacy)).rejects.toMatchObject({ statusCode: 400 });
    expect(repository.create).not.toHaveBeenCalled();
    expect(encrypt).not.toHaveBeenCalled();
  });
  it("previews the actual reserved resource in shadow and passes that ID to legacy creation", async () => {
    env.security.iamAuthorizationMode = "shadow";
    await create();
    expect(repository.create.mock.calls[0]?.[6]).toBe(false);
    expect(legacy).toHaveBeenCalledWith("target");
  });
  it("keeps the legacy outcome in shadow when the future resource is denied", async () => {
    env.security.iamAuthorizationMode = "shadow";
    iam.authorizeMany.mockRejectedValue(new Error("fixture denied"));
    await create();
    expect(legacy).toHaveBeenCalledWith("target");
    expect(repository.create).not.toHaveBeenCalled();
  });
  it("preserves legacy generation and permission checks", async () => {
    env.security.iamAuthorizationMode = "legacy";
    await create();
    expect(allocateId).not.toHaveBeenCalled();
    expect(legacy).toHaveBeenCalledWith();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(create()).rejects.toMatchObject({ statusCode: 403 });
  });
});
