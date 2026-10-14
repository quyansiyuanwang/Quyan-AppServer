import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/remote-terminal-product/remote-terminal-device-read.repository", () => ({
  RemoteTerminalDeviceReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
import { env } from "@/config/env";
import { RemoteTerminalDeviceReadIamService } from "@/services/remote-terminal/remote-terminal-device-read-iam.service";
import { remoteTerminalDeviceArn } from "@/iam/resources/remote-terminal-resources";
import { assertTerminalDeviceTargets } from "@/store/remote-terminal-product/remote-terminal-device-snapshot";
import { RemoteTerminalDeviceReadRepository } from "@/store/remote-terminal-product/remote-terminal-device-read.repository";
import { remoteTerminalQueryDeviceResourceResolver } from "@/iam/request/remote-terminal-resource-resolvers";
import { getIamPrincipal } from "@/iam/request/principal-context";
import {
  getIamActionDefinition,
  isIamActionResourceCompatible,
  iamActionsForLegacyPermission,
  Permission,
} from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
import type { RemoteTerminalDeviceTarget } from "@/store/remote-terminal-product/remote-terminal-device-read.store";
const mode = env.security.iamAuthorizationMode,
  repository = { scan: vi.fn(), targets: vi.fn(), hydrate: vi.fn() },
  iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  service = new RemoteTerminalDeviceReadIamService(repository, iam, permissions),
  legacy = vi.fn();
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    query: { deviceId: "device-a" },
    headers: { "x-action": "*", "x-account-id": "foreign" },
    secure: true,
    ip: "192.0.2.10",
  }) as unknown as TypedRequest;
const target = (id = "a"): RemoteTerminalDeviceTarget => ({
  id,
  userId: "actor",
  deviceId: "device-" + id,
  controlRevision: "a".repeat(64),
  summaryRevision: "b".repeat(64),
});
const summary = (row: RemoteTerminalDeviceTarget) => ({
  deviceId: row.deviceId,
  hostname: "fixture-host",
  platform: "linux" as const,
  arch: "x64",
  availableShells: ["bash" as const],
  registeredAt: "2026-10-14T00:00:00.000Z",
  lastSeenAt: "2026-10-14T00:00:00.000Z",
  online: true,
});
const decision = (value = "Allow") => ({ decision: value, reason: "fixture", matchedStatements: [] });
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) => resources.map(() => decision()));
  repository.scan.mockResolvedValue([target()]);
  repository.targets.mockResolvedValue([target()]);
  repository.hydrate.mockImplementation(async (_principal, rows) => rows.map(summary));
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  legacy.mockResolvedValue([{ deviceId: "legacy" }]);
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("terminal device resource reads", () => {
  it("filters Deny before hydration and never calls the legacy reader in enforce", async () => {
    repository.scan.mockResolvedValue([target("a"), target("b")]);
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map((resource: string) => decision(resource.endsWith("/device-b") ? "ExplicitDeny" : "Allow")),
    );
    expect(await service.list("actor", request(), legacy)).toEqual([summary(target())]);
    expect(repository.hydrate).toHaveBeenCalledWith(expect.objectContaining({ accountOwnerId: "owner" }), [target()]);
    expect(legacy).not.toHaveBeenCalled();
  });
  it("returns an empty list with valid identity but no matching Allow", async () => {
    iam.authorizeMany.mockResolvedValue([decision("ImplicitDeny")]);
    repository.hydrate.mockResolvedValue([]);
    expect(await service.list("actor", request(), legacy)).toEqual([]);
    expect(repository.hydrate).toHaveBeenCalledWith(expect.anything(), []);
  });
  it.each([
    undefined,
    { user: { userId: "actor" } },
    { ...request(), user: { userId: "other" } },
    { ...request(), oauthAccessToken: {} },
  ])("fails closed for untrusted request %j", async (value) => {
    await expect(service.list("actor", value as TypedRequest, legacy)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.scan).not.toHaveBeenCalled();
  });
  it("validates identity even for an empty collection", async () => {
    repository.scan.mockResolvedValue([]);
    iam.loadPolicies.mockRejectedValue(new Error("unavailable"));
    await expect(service.list("actor", request(), legacy)).rejects.toThrow();
    expect(repository.scan).not.toHaveBeenCalled();
  });
  it.each(["cross-user", "duplicate", "invalid", "out-of-order", "oversized"])(
    "rejects corrupt %s metadata before hydration",
    async (kind) => {
      const rows =
        kind === "cross-user"
          ? [{ ...target(), userId: "other" }]
          : kind === "duplicate"
            ? [target(), target()]
            : kind === "invalid"
              ? [{ ...target(), deviceId: "*" }]
              : kind === "out-of-order"
                ? [target("b"), target("a")]
                : Array.from({ length: 501 }, (_, i) => target("d" + String(i).padStart(3, "0")));
      repository.scan.mockResolvedValue(rows);
      await expect(service.list("actor", request(), legacy)).rejects.toMatchObject({ statusCode: 403 });
      expect(repository.hydrate).not.toHaveBeenCalled();
    },
  );
  it("rejects incomplete batch decisions before hydration", async () => {
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.list("actor", request(), legacy)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it.each(["missing", "duplicate", "secret"])("rejects corrupt %s public hydration", async (kind) => {
    repository.hydrate.mockResolvedValue(
      kind === "missing"
        ? []
        : kind === "duplicate"
          ? [summary(target()), summary(target())]
          : [{ ...summary(target()), heartbeatToken: "fixture-only" }],
    );
    await expect(service.list("actor", request(), legacy)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects raw summary edits after hydration", async () => {
    repository.targets.mockResolvedValue([{ ...target(), summaryRevision: "c".repeat(64) }]);
    await expect(service.list("actor", request(), legacy)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks Condition decisions after hydration", async () => {
    iam.authorizeMany
      .mockResolvedValueOnce([decision()])
      .mockResolvedValueOnce([decision()])
      .mockResolvedValue([decision("ExplicitDeny")]);
    await expect(service.list("actor", request(), legacy)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects policy binding changes before hydration", async () => {
    iam.loadPolicies
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        {
          policyId: "new",
          document: {
            Version: "1",
            Statement: [{ Effect: "Allow", Action: "quyan:remote_terminal:ListDevices", Resource: "*" }],
          },
        },
      ]);
    await expect(service.list("actor", request(), legacy)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("continues scanning past a full denied metadata batch", async () => {
    const first = Array.from({ length: 500 }, (_, i) => target("d" + String(i).padStart(3, "0"))),
      last = target("z");
    repository.scan.mockResolvedValueOnce(first).mockResolvedValueOnce([last]);
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map((resource: string) => decision(resource.endsWith("/device-z") ? "Allow" : "ImplicitDeny")),
    );
    repository.targets.mockResolvedValue([last]);
    expect(await service.list("actor", request(), legacy)).toEqual([summary(last)]);
    expect(repository.scan).toHaveBeenNthCalledWith(2, expect.anything(), "d499");
  });
  it.each(["legacy", "shadow"] as const)("preserves exactly one legacy read in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    iam.authorizeMany.mockResolvedValue([decision("ExplicitDeny")]);
    repository.hydrate.mockResolvedValue([]);
    expect(await service.list("actor", request(), legacy)).toEqual([{ deviceId: "legacy" }]);
    expect(legacy).toHaveBeenCalledTimes(1);
  });
  it("keeps legacy permission failures authoritative in shadow", async () => {
    env.security.iamAuthorizationMode = "shadow";
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.list("actor", request(), legacy)).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).not.toHaveBeenCalled();
  });
  it("authorizes again at dispatch and before returning directory content", async () => {
    const read = vi.fn(async (guard) => {
      await guard();
      return { items: [] };
    });
    expect(
      await service.readDevice("actor", "device-a", "quyan:remote_terminal:BrowseDirectories", request(), read),
    ).toEqual({ items: [] });
    expect(read).toHaveBeenCalledTimes(1);
    expect(iam.authorizeMany).toHaveBeenCalledTimes(3);
  });
  it("does not dispatch an explicitly denied device read", async () => {
    const read = vi.fn();
    iam.authorizeMany.mockResolvedValue([decision("ExplicitDeny")]);
    await expect(
      service.readDevice("actor", "device-a", "quyan:remote_terminal:GetAgentPreferences", request(), read),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
  });
  it("discards RPC results when device entitlement changes", async () => {
    const read = vi.fn(async () => {
      repository.targets.mockResolvedValue([{ ...target(), controlRevision: "c".repeat(64) }]);
      return { private: "fixture" };
    });
    await expect(
      service.readDevice("actor", "device-a", "quyan:remote_terminal:GetAgentPreferences", request(), read),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("does not invalidate a device read for heartbeat-only summary changes", async () => {
    const read = vi.fn(async (guard) => {
      repository.targets.mockResolvedValue([{ ...target(), summaryRevision: "c".repeat(64) }]);
      await guard();
      return { items: [] };
    });
    await expect(
      service.readDevice("actor", "device-a", "quyan:remote_terminal:BrowseDirectories", request(), read),
    ).resolves.toEqual({ items: [] });
  });
  it("discards RPC results after policy revocation", async () => {
    const read = vi.fn(async () => {
      iam.authorizeMany.mockResolvedValue([decision("ImplicitDeny")]);
      return { private: "fixture" };
    });
    await expect(
      service.readDevice("actor", "device-a", "quyan:remote_terminal:GetAgentPreferences", request(), read),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not issue a second RPC for shadow evaluation", async () => {
    env.security.iamAuthorizationMode = "shadow";
    iam.authorizeMany.mockResolvedValue([decision("ExplicitDeny")]);
    const read = vi.fn(async (guard) => {
      await guard?.();
      return { legacy: true };
    });
    expect(
      await service.readDevice("actor", "device-a", "quyan:remote_terminal:GetAgentPreferences", request(), read),
    ).toEqual({ legacy: true });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("keeps trusted caller identity frozen through dispatch", async () => {
    const req = request();
    const read = vi.fn(async () => {
      req.authContext!.accountOwnerId = "foreign";
      return { private: "fixture" };
    });
    await expect(
      service.readDevice("actor", "device-a", "quyan:remote_terminal:BrowseDirectories", req, read),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects unknown modes", async () => {
    env.security.iamAuthorizationMode = "invalid" as typeof mode;
    await expect(service.list("actor", request(), legacy)).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).not.toHaveBeenCalled();
  });
});
describe("terminal catalog and resolver contracts", () => {
  it("registers real service Actions and device resources without self defaults", () => {
    const arn = remoteTerminalDeviceArn("owner", "actor", "device-a");
    for (const operation of ["ListDevices", "BrowseDirectories", "GetAgentPreferences"]) {
      const action = "quyan:remote_terminal:" + operation;
      expect(isIamActionResourceCompatible(action, arn)).toBe(true);
      expect(getIamActionDefinition(action)?.defaultAuthorizationScope).toBeUndefined();
      expect(iamActionsForLegacyPermission(Permission.REMOTE_TERMINAL_DEVICE_READ)).toContain(action);
    }
    expect(isIamActionResourceCompatible("quyan:ram:UpdateUser", arn)).toBe(false);
  });
  it("requires exact ownership and ignores forged client Action/account headers", async () => {
    vi.mocked(RemoteTerminalDeviceReadRepository.getInstance).mockReturnValue(
      repository as unknown as RemoteTerminalDeviceReadRepository,
    );
    const req = request(),
      principal = getIamPrincipal(req)!;
    expect(await remoteTerminalQueryDeviceResourceResolver({ request: req, principal })).toBe(
      remoteTerminalDeviceArn("owner", "actor", "device-a"),
    );
    repository.targets.mockResolvedValue([{ ...target(), userId: "other" }]);
    expect(await remoteTerminalQueryDeviceResourceResolver({ request: req, principal })).toBeUndefined();
  });
  it.each(["*", "device/a", ["device-a"], " DEVICE-a"])("rejects malformed device query %j", async (value) => {
    const req = request();
    req.query.deviceId = value as string;
    expect(
      await remoteTerminalQueryDeviceResourceResolver({ request: req, principal: getIamPrincipal(req)! }),
    ).toBeUndefined();
    expect(repository.targets).not.toHaveBeenCalled();
  });
  it("declares named resource metadata for all three migrated routes", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const source = project.addSourceFileAtPath("src/api/controllers/v1/remote-terminal/remote-terminal.controller.ts");
    const routes = collectIamRoutes([source], process.cwd()).filter((row) =>
      ["listDevices", "browseDirectories", "getAgentPreferences"].includes(row.method),
    );
    expect(routes).toHaveLength(3);
    expect(routes.every((row) => row.coverage === "explicit" && !row.issues.length)).toBe(true);
  });
  it("detects source changes even when updateTime is unchanged", () => {
    expect(() => assertTerminalDeviceTargets([{ ...target(), controlRevision: "c".repeat(64) }], [target()])).toThrow();
    expect(() =>
      assertTerminalDeviceTargets([{ ...target(), summaryRevision: "c".repeat(64) }], [target()], false),
    ).not.toThrow();
  });
});
