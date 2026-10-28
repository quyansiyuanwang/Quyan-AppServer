import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/users/iam-access-key-authority", () => ({ captureIamAccessKeyRevision: vi.fn() }));
vi.mock("@/store/users/iam-oauth-authority", () => ({ captureIamOAuthRevision: vi.fn() }));
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { env } from "@/config/env";
import { PlatformRelayRequestReadIamService } from "@/services/relay/platform-relay-request-read-iam.service";
import { platformRelayRequestArn } from "@/iam/resources/platform-relay-request-resources";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { captureIamOAuthRevision } from "@/store/users/iam-oauth-authority";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode;
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { scan: vi.fn(), hydrate: vi.fn(), traceTarget: vi.fn(), channels: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  legacy = vi.fn();
const service = new PlatformRelayRequestReadIamService(iam, snapshots, repository, permissions);
const req = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "fake:*" },
    secure: true,
  }) as unknown as TypedRequest;
const target = {
  id: "logical",
  requestId: "request",
  relayTokenId: "token",
  createTime: new Date(0),
  updateTime: new Date(0),
  relayToken: {
    id: "token",
    userId: "actor",
    status: 1,
    updateTime: new Date(0),
    user: { id: "actor", status: 1, updateTime: new Date(0) },
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
  snapshots.snapshot.mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] });
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  repository.scan.mockResolvedValue([]);
  repository.traceTarget.mockResolvedValue(target);
  repository.channels.mockResolvedValue([{ id: "channel", name: "safe", status: 1, updateTime: new Date(0) }]);
  repository.hydrate.mockResolvedValue({
    row: {
      ...target,
      relayToken: { ...target.relayToken, name: "safe", user: { ...target.relayToken.user, username: "user" } },
    },
    usages: [
      {
        id: "usage",
        executionChannelId: "channel",
        statusCode: 200,
        method: "POST",
        path: "/v1/chat/completions",
        totalTokens: 3,
        timeToFirstByte: null,
        totalOutputTime: null,
        createTime: new Date(0),
      },
    ],
  });
  legacy.mockResolvedValue({ total: 0, page: 1, pageSize: 20, records: [] });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("resource diagnostic contracts and server-owned actions", () => {
  it("declares both server actions and their platform resources", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const [key, action] of [
      ["GET /v1/relay/request-diagnostics", "quyan:relay:ListRequestDiagnostics"],
      ["GET /v1/relay/request-diagnostics/{requestId}/route-trace", "quyan:relay:GetRequestRouteTrace"],
    ])
      expect(routes.find((row) => row.key === key)).toMatchObject({
        coverage: "explicit",
        actions: [action],
        issues: [],
      });
    expect(getIamActionDefinition("quyan:relay:GetRequestRouteTrace")).toMatchObject({
      authorizationBoundary: "platform",
      requiredActions: ["quyan:relay:ListRequestDiagnostics"],
      conditionalActions: ["quyan:relay:ReadChannelPoolMetadata"],
    });
    expect(
      isIamActionResourceCompatible("quyan:relay:ListRequestDiagnostics", platformRelayRequestArn("logical")),
    ).toBe(true);
    expect(
      isIamActionResourceCompatible("quyan:relay:ListRequestDiagnostics", platformRelayChannelArn("channel")),
    ).toBe(false);
  });
  it("requires each platform ceiling rather than treating the list as any-of", async () => {
    await service.trace("actor", "request", req(), legacy);
    expect(snapshots.snapshot.mock.calls.map((call) => call[1])).toEqual([
      Permission.RELAY_REQUEST_DIAGNOSTICS_READ,
      Permission.RELAY_REQUEST_ROUTE_TRACE_READ,
      Permission.RELAY_CHANNEL_POOL_METADATA_READ,
    ]);
  });
  it("ignores forged action headers and does not require unrelated token reveal", async () => {
    await service.trace("actor", "request", req(), legacy);
    expect(new Set(iam.authorizeMany.mock.calls.map(([input]) => input.action))).toEqual(
      new Set([
        "quyan:relay:ListRequestDiagnostics",
        "quyan:relay:GetRequestRouteTrace",
        "quyan:relay:ReadChannelPoolMetadata",
      ]),
    );
  });
  it("denies physical channel metadata before reading channel names", async () => {
    iam.authorizeMany.mockImplementation(async ({ action, resources }) =>
      resources.map(() => ({
        decision: action.endsWith("ReadChannelPoolMetadata") ? "ExplicitDeny" : "Allow",
        reason: "fixture",
        matchedStatements: [],
      })),
    );
    await expect(service.trace("actor", "request", req(), legacy)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.channels).not.toHaveBeenCalled();
  });
  it("rechecks request binding after the final asynchronous identity proof", async () => {
    const request = req();
    snapshots.recheck.mockImplementation(async () => {
      request.authContext!.accountOwnerId = "foreign";
    });
    await expect(service.list("actor", {}, request, legacy)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.scan).not.toHaveBeenCalled();
  });
  it("discards an already projected trace if any contributing decision changes", async () => {
    repository.channels.mockImplementation(async () => {
      iam.authorizeMany.mockResolvedValue([{ decision: "ExplicitDeny", reason: "fixture", matchedStatements: [] }]);
      return [{ id: "channel", name: "safe", status: 1, updateTime: new Date(0) }];
    });
    await expect(service.trace("actor", "request", req(), legacy)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("keeps denied rows out of projection", async () => {
    repository.scan.mockResolvedValue([target]);
    iam.authorizeMany.mockResolvedValue([{ decision: "ExplicitDeny", reason: "fixture", matchedStatements: [] }]);
    expect(await service.list("actor", {}, req(), legacy)).toMatchObject({ total: 0, records: [] });
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("rejects malformed decision shapes", async () => {
    repository.scan.mockResolvedValue([target]);
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.list("actor", {}, req(), legacy)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses persisted original JWT scope for OAuth instead of trusting request scopes", async () => {
    const request = {
      ...req(),
      oauthAccessToken: { id: "oauth", oauthClientId: "client", userId: "actor", scopes: ["*"] },
    } as TypedRequest;
    await service.list("actor", {}, request, legacy);
    expect(captureIamOAuthRevision).toHaveBeenCalledWith(
      expect.objectContaining({ subjectUserId: "actor" }),
      { id: "oauth", clientId: "client" },
      ["relay:usage:read"],
    );
  });
  it("shadow performs no attempt or channel projection and calls legacy once", async () => {
    env.security.iamAuthorizationMode = "shadow";
    await service.trace("actor", "request", req(), legacy);
    expect(repository.hydrate).not.toHaveBeenCalled();
    expect(repository.channels).not.toHaveBeenCalled();
    expect(legacy).toHaveBeenCalledTimes(1);
  });
  it.each(["legacy", "shadow"] as const)("retains all original permission admission in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.trace("actor", "request", req(), legacy)).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).not.toHaveBeenCalled();
  });
  it("never falls back to legacy on a policy or authority read failure in enforce", async () => {
    snapshots.snapshot.mockRejectedValue(new Error("fixture read failure"));
    await expect(service.list("actor", {}, req(), legacy)).rejects.toThrow("fixture read failure");
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each(["", " ", "x".repeat(65)])("rejects invalid trace labels before data lookup", async (id) => {
    await expect(service.trace("actor", id, req(), legacy)).rejects.toMatchObject({ statusCode: 400 });
    expect(repository.traceTarget).not.toHaveBeenCalled();
  });
});
