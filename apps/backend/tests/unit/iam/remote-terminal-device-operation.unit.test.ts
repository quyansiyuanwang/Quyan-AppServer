import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/remote-terminal-product/remote-terminal-device-read.repository", () => ({
  RemoteTerminalDeviceReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/remote-terminal-product/remote-terminal-device-probe.repository", () => ({
  RemoteTerminalDeviceProbeRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
import { env } from "@/config/env";
import { RemoteTerminalDeviceIamService } from "@/services/remote-terminal/remote-terminal-device-iam.service";
import { RemoteTerminalDeviceReadRepository } from "@/store/remote-terminal-product/remote-terminal-device-read.repository";
import { remoteTerminalBodyDeviceResourceResolver } from "@/iam/request/remote-terminal-resource-resolvers";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { iamActionsForLegacyPermission, Permission, getIamActionDefinition } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  repository = { scan: vi.fn(), targets: vi.fn(), hydrate: vi.fn() },
  iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  probes = { revision: vi.fn(), record: vi.fn() },
  service = new RemoteTerminalDeviceIamService(repository, iam, permissions, probes),
  legacy = vi.fn(),
  dispatch = vi.fn();
const target = (id = "a") => ({
  id,
  deviceId: "device-" + id,
  userId: "actor",
  controlRevision: "a".repeat(64),
  summaryRevision: "b".repeat(64),
});
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    body: { deviceId: "device-a", accountId: "foreign", action: "*" },
    headers: { "x-action": "*" },
    secure: true,
    ip: "192.0.2.10",
  }) as unknown as TypedRequest;
const decision = (value = "Allow") => ({ decision: value, reason: "fixture", matchedStatements: [] });
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) => resources.map(() => decision()));
  repository.scan.mockResolvedValue([target()]);
  repository.targets.mockImplementation(async (_principal, ids) =>
    ids.map((id: string) => target(id.slice("device-".length))),
  );
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  probes.revision.mockResolvedValue("c".repeat(64));
  probes.record.mockImplementation(async (guard, pongAt) => ({
    deviceId: guard.target.deviceId,
    online: Boolean(pongAt),
    lastSeenAt: "2026-10-14T00:00:00.000Z",
  }));
  dispatch.mockImplementation(async (_id, guard) => {
    await guard();
    return null;
  });
  legacy.mockResolvedValue({ items: [{ deviceId: "legacy" }] });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("terminal selected device probes", () => {
  it("never pings or writes denied devices and never hydrates their summaries", async () => {
    repository.scan.mockResolvedValue([target("a"), target("b")]);
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map((r: string) => decision(r.endsWith("/device-b") ? "ExplicitDeny" : "Allow")),
    );
    expect(await service.probe("actor", request(), legacy, dispatch)).toEqual({
      items: [{ deviceId: "device-a", online: false, lastSeenAt: "2026-10-14T00:00:00.000Z" }],
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith("device-a", expect.any(Function));
    expect(probes.record).toHaveBeenCalledTimes(1);
    expect(repository.hydrate).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });
  it("returns an empty result without dispatch when no Allow matches", async () => {
    iam.authorizeMany.mockResolvedValue([decision("ImplicitDeny")]);
    expect(await service.probe("actor", request(), legacy, dispatch)).toEqual({ items: [] });
    expect(dispatch).not.toHaveBeenCalled();
    expect(probes.record).not.toHaveBeenCalled();
  });
  it("bounds parallel transport dispatch while committing device statuses in order", async () => {
    const rows = Array.from({ length: 11 }, (_, i) => target("d" + String(i).padStart(2, "0")));
    repository.scan.mockResolvedValue(rows);
    let active = 0,
      maximum = 0;
    dispatch.mockImplementation(async (_id, guard) => {
      await guard();
      active++;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active--;
      return null;
    });
    const result = await service.probe("actor", request(), legacy, dispatch);
    expect(maximum).toBeLessThanOrEqual(8);
    expect(maximum).toBeGreaterThan(1);
    expect(result.items.map((item) => item.deviceId)).toEqual(rows.map((row) => row.deviceId));
    expect(probes.record).toHaveBeenCalledTimes(11);
  });
  it("passes the trusted target and authorization revision to the commit guard", async () => {
    await service.probe("actor", request(), legacy, dispatch);
    expect(probes.record).toHaveBeenCalledWith(
      {
        principal: expect.objectContaining({ accountOwnerId: "owner", subjectUserId: "actor" }),
        target: target(),
        authorizationRevision: "c".repeat(64),
        recheck: expect.any(Function),
      },
      null,
    );
  });
  it("rejects revocation before ping", async () => {
    iam.authorizeMany.mockResolvedValueOnce([decision()]).mockResolvedValue([decision("ExplicitDeny")]);
    await expect(service.probe("actor", request(), legacy, dispatch)).rejects.toMatchObject({ statusCode: 403 });
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("does not write probe status after revocation during ping", async () => {
    dispatch.mockImplementation(async () => {
      iam.authorizeMany.mockResolvedValue([decision("ExplicitDeny")]);
      return new Date();
    });
    await expect(service.probe("actor", request(), legacy, dispatch)).rejects.toMatchObject({ statusCode: 403 });
    expect(probes.record).not.toHaveBeenCalled();
  });
  it("does not write probe status after ownership changes during ping", async () => {
    dispatch.mockImplementation(async () => {
      repository.targets.mockResolvedValue([{ ...target(), controlRevision: "e".repeat(64) }]);
      return null;
    });
    await expect(service.probe("actor", request(), legacy, dispatch)).rejects.toMatchObject({ statusCode: 403 });
    expect(probes.record).not.toHaveBeenCalled();
  });
  it("does not invalidate a permitted probe for normal heartbeat changes", async () => {
    dispatch.mockImplementation(async () => {
      repository.targets.mockResolvedValue([{ ...target(), summaryRevision: "e".repeat(64) }]);
      return new Date(0);
    });
    await expect(service.probe("actor", request(), legacy, dispatch)).resolves.toMatchObject({
      items: [{ deviceId: "device-a", online: true }],
    });
  });
  it.each(["legacy", "shadow"] as const)("dispatches only the legacy operation once in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    iam.authorizeMany.mockResolvedValue([decision("ExplicitDeny")]);
    expect(await service.probe("actor", request(), legacy, dispatch)).toEqual({ items: [{ deviceId: "legacy" }] });
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
    expect(probes.record).not.toHaveBeenCalled();
  });
  it("keeps old read permission authoritative during shadow probe", async () => {
    env.security.iamAuthorizationMode = "shadow";
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.probe("actor", request(), legacy, dispatch)).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each([undefined, { user: { userId: "actor" } }, { ...request(), user: { userId: "other" } }])(
    "rejects untrusted probe context %j",
    async (req) => {
      await expect(service.probe("actor", req as TypedRequest, legacy, dispatch)).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(dispatch).not.toHaveBeenCalled();
    },
  );
  it("refuses partial authorization decisions", async () => {
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.probe("actor", request(), legacy, dispatch)).rejects.toMatchObject({ statusCode: 403 });
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("fails before dispatch if metadata contains a different subject", async () => {
    repository.scan.mockResolvedValue([{ ...target(), userId: "other" }]);
    await expect(service.probe("actor", request(), legacy, dispatch)).rejects.toMatchObject({ statusCode: 403 });
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("rejects source commit failures and does not fall back to legacy", async () => {
    probes.record.mockRejectedValue(new Error("fixture commit failed"));
    await expect(service.probe("actor", request(), legacy, dispatch)).rejects.toThrow("fixture commit failed");
    expect(legacy).not.toHaveBeenCalled();
  });
});
describe("terminal preference writes", () => {
  it("checks the write Action rather than deriving it from the request", async () => {
    const write = vi.fn(async (guard) => {
      await guard?.();
      return { saved: true };
    });
    expect(
      await service.withDevice("actor", "device-a", "quyan:remote_terminal:UpdateAgentPreferences", request(), write),
    ).toEqual({ saved: true });
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:remote_terminal:UpdateAgentPreferences",
        resources: ["acs:remote-terminal:*:owner:device/actor/device-a"],
      }),
    );
  });
  it("never dispatches an explicitly denied preferences-set", async () => {
    const write = vi.fn();
    iam.authorizeMany.mockResolvedValue([decision("ExplicitDeny")]);
    await expect(
      service.withDevice("actor", "device-a", "quyan:remote_terminal:UpdateAgentPreferences", request(), write),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(write).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("checks the old write permission and writes once in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    iam.authorizeMany.mockResolvedValue([decision("ExplicitDeny")]);
    const write = vi.fn(async (guard) => {
      await guard?.();
      return { saved: true };
    });
    expect(
      await service.withDevice("actor", "device-a", "quyan:remote_terminal:UpdateAgentPreferences", request(), write),
    ).toEqual({ saved: true });
    expect(write).toHaveBeenCalledTimes(1);
    expect(permissions.checkUserPermissions).toHaveBeenCalledWith("actor", [Permission.REMOTE_TERMINAL_DEVICE_WRITE], {
      assumedRoleSessionId: undefined,
    });
  });
  it("cannot use a device read grant as a legacy write grant", async () => {
    env.security.iamAuthorizationMode = "legacy";
    permissions.checkUserPermissions.mockImplementation(async (_user, values) => ({
      hasPermission: !values.includes(Permission.REMOTE_TERMINAL_DEVICE_WRITE),
    }));
    const write = vi.fn();
    await expect(
      service.withDevice("actor", "device-a", "quyan:remote_terminal:UpdateAgentPreferences", request(), write),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(write).not.toHaveBeenCalled();
  });
  it("resolves only the body device ID with persisted subject ownership", async () => {
    vi.mocked(RemoteTerminalDeviceReadRepository.getInstance).mockReturnValue(
      repository as unknown as RemoteTerminalDeviceReadRepository,
    );
    const req = request();
    expect(await remoteTerminalBodyDeviceResourceResolver({ request: req, principal: getIamPrincipal(req)! })).toBe(
      "acs:remote-terminal:*:owner:device/actor/device-a",
    );
    Object.defineProperty(req, "body", { value: { deviceId: "*" } });
    expect(
      await remoteTerminalBodyDeviceResourceResolver({ request: req, principal: getIamPrincipal(req)! }),
    ).toBeUndefined();
  });
  it("keeps writes outside read permission aliases", () => {
    expect(iamActionsForLegacyPermission(Permission.REMOTE_TERMINAL_DEVICE_READ)).not.toContain(
      "quyan:remote_terminal:UpdateAgentPreferences",
    );
    expect(iamActionsForLegacyPermission(Permission.REMOTE_TERMINAL_DEVICE_WRITE)).toContain(
      "quyan:remote_terminal:UpdateAgentPreferences",
    );
    expect(getIamActionDefinition("quyan:remote_terminal:UpdateAgentPreferences")).toMatchObject({
      accessLevel: "Write",
      sensitive: true,
    });
  });
  it("declares named server metadata for both operation routes", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true }),
      source = project.addSourceFileAtPath("src/api/controllers/v1/remote-terminal/remote-terminal.controller.ts");
    const rows = collectIamRoutes([source], process.cwd()).filter((row) =>
      ["probeDevices", "updateAgentPreferences"].includes(row.method),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.coverage === "explicit" && !row.issues.length)).toBe(true);
  });
});
