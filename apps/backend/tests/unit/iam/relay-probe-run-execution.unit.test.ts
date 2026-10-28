import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/services/infrastructure/redis.service", () => ({ RedisService: { getInstance: vi.fn() } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/relay/relay-channel.service", () => ({ RelayChannelService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { RelayProbeRunAdmissionStore } from "@/services/relay/relay-probe-run-admission";
import { RelayProbeRunExecutionIamService } from "@/services/relay/relay-probe-run-execution-iam.service";
import { RelayProbeRunExecutionRepository } from "@/store/relay/relay-probe-run-execution.repository";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const mode = env.security.iamAuthorizationMode;
const admissions = new RelayProbeRunAdmissionStore(),
  repository = new RelayProbeRunExecutionRepository(),
  identities = new PlatformManagementReadRepository();
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  channels = { canAccessChannelMetadata: vi.fn() };
const service = new RelayProbeRunExecutionIamService(admissions, repository, identities, iam, channels);
const fixture = () => ({
  version: 1 as const,
  runId: "run",
  channelId: "channel",
  memberChannelId: "member",
  profileId: "profile",
  profileUpdatedAt: new Date(0).toISOString(),
  targetConfigId: "config",
  targetConfigUpdatedAt: new Date(0).toISOString(),
  accountId: "account",
  principal: {
    subjectUserId: "actor",
    principalUserId: "actor",
    accountOwnerId: "owner",
    subjectType: "sub_user" as const,
  },
  identity: { principalUpdatedAt: new Date(0).toISOString(), ownerUpdatedAt: new Date(0).toISOString() },
  transport: { "acs:SecureTransport": true, "acs:SourceIp": "192.0.2.1" },
  expiresAt: Date.now() + 60_000,
});
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  vi.spyOn(admissions, "read").mockImplementation(async () => fixture());
  vi.spyOn(repository, "inspect").mockResolvedValue({
    id: "channel",
    visibilityMode: "public",
    visibilityConfig: null,
  } as Awaited<ReturnType<typeof repository.inspect>>);
  vi.spyOn(identities, "snapshot").mockResolvedValue({
    group: { id: "global", updateTime: new Date(0) },
    users: [
      { id: "actor", updateTime: new Date(0) },
      { id: "owner", updateTime: new Date(0) },
    ],
  });
  vi.spyOn(identities, "recheck").mockResolvedValue(undefined);
  iam.loadPolicies.mockResolvedValue([]);
  channels.canAccessChannelMetadata.mockResolvedValue(true);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("probe worker lifecycle authorization", () => {
  it("uses the registered server-fixed creation action and retains HTTP step-up/replay protection", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const file = project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel-probe.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "POST /v1/relay-channel-probes/{channelId}/runs",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:CreateProbeRun"], issues: [] });
    const method = file.getClassOrThrow("RelayChannelProbeController").getMethodOrThrow("createRun").getText();
    expect(method).toContain("@ReplayProtected()");
    expect(method).toContain("@TwoFactorChallengeProtected");
    expect(getIamActionDefinition("quyan:relay:CreateProbeRun")).toMatchObject({
      legacyPermission: Permission.RELAY_CHANNEL_PROBE_EXECUTE,
      accessLevel: "Write",
    });
  });
  it("checks claim, persisted identity, visibility and every related resource before execution", async () => {
    const recheck = await service.prepare("run", "worker");
    await recheck();
    expect(repository.inspect).toHaveBeenCalledWith("run", "worker", expect.objectContaining({ profileId: "profile" }));
    expect(identities.recheck).toHaveBeenCalledWith(
      fixture().principal,
      Permission.RELAY_CHANNEL_PROBE_EXECUTE,
      expect.anything(),
    );
    const input = iam.authorizeMany.mock.calls[0]![0];
    expect(input.action).toBe("quyan:relay:CreateProbeRun");
    expect(input.resources).toHaveLength(6);
    for (const resource of input.resources) expect(isIamActionResourceCompatible(input.action, resource)).toBe(true);
    expect(auditIamDecision).toHaveBeenCalledTimes(12);
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])("stops before execution when any resource is %s", async (decision) => {
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map((_: string, index: number) => ({ decision: index === 2 ? decision : "Allow" })),
    );
    await expect(service.prepare("run", "worker")).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each([[], [null], [{ decision: "Unknown" }], null])(
    "fails closed on malformed decision batches",
    async (result) => {
      iam.authorizeMany.mockResolvedValue(result);
      await expect(service.prepare("run", "worker")).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("checks persisted identity/session again after queue or lock waits", async () => {
    const recheck = await service.prepare("run", "worker");
    vi.mocked(identities.recheck).mockRejectedValue(new Error("session expired"));
    await expect(recheck()).rejects.toThrow("session expired");
    expect(iam.authorizeMany).toHaveBeenCalledTimes(1);
  });
  it("rejects expired admissions, policy changes, lost claims and configuration drift", async () => {
    const input = fixture();
    vi.mocked(admissions.read).mockResolvedValue(input);
    const recheck = await service.prepare("run", "worker");
    input.expiresAt = 1;
    await expect(recheck()).rejects.toMatchObject({ statusCode: 403 });
    input.expiresAt = Date.now() + 60_000;
    vi.mocked(repository.inspect).mockRejectedValue(new Error("claim or config changed"));
    await expect(recheck()).rejects.toThrow("claim or config changed");
  });
  it("does not continue after policy or visibility changes", async () => {
    const recheck = await service.prepare("run", "worker");
    channels.canAccessChannelMetadata.mockResolvedValue(false);
    await expect(recheck()).rejects.toMatchObject({ statusCode: 403 });
    channels.canAccessChannelMetadata.mockResolvedValue(true);
    iam.loadPolicies.mockResolvedValue([
      {
        policyId: "changed",
        document: { Version: "1", Statement: [{ Effect: "Deny", Action: ["*"], Resource: ["*"] }] },
      },
    ]);
    await expect(recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("recalculates CurrentTime, but preserves authenticated transport and role context", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T00:00:00Z"));
    const input = fixture();
    vi.mocked(admissions.read).mockResolvedValue({
      ...input,
      principal: { ...input.principal, subjectType: "assumed_role", assumedRoleId: "role", roleSessionId: "session" },
    });
    const recheck = await service.prepare("run", "worker");
    const before = iam.authorizeMany.mock.calls[0]![0].context["acs:CurrentTime"];
    vi.advanceTimersByTime(1_000);
    await recheck();
    expect(iam.authorizeMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({ roleSessionId: "session" }),
        context: expect.objectContaining({
          "acs:SourceIp": "192.0.2.1",
          "acs:SecureTransport": true,
          "quyan:PrincipalType": "assumed_role",
        }),
      }),
    );
    expect(Date.parse(iam.authorizeMany.mock.calls[1]![0].context["acs:CurrentTime"]) - Date.parse(before)).toBe(1_000);
  });
  it("does not read admission data for legacy jobs, but rechecks their claim", async () => {
    env.security.iamAuthorizationMode = "legacy";
    const recheck = await service.prepare("run", "worker");
    await recheck();
    expect(admissions.read).not.toHaveBeenCalled();
    expect(repository.inspect).toHaveBeenCalledTimes(2);
  });
  it.each(["legacy", "shadow", "enforce"] as const)(
    "fails closed if mode changes after a %s admission",
    async (start) => {
      env.security.iamAuthorizationMode = start;
      const recheck = await service.prepare("run", "worker");
      env.security.iamAuthorizationMode = start === "enforce" ? "legacy" : "enforce";
      await expect(recheck()).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("shadow retains legacy claims even if admission is missing, but cannot bypass a reset", async () => {
    env.security.iamAuthorizationMode = "shadow";
    vi.mocked(admissions.read).mockRejectedValue(new Error("missing admission"));
    const recheck = await service.prepare("run", "worker");
    await recheck();
    vi.mocked(repository.inspect).mockRejectedValue(new Error("reset"));
    await expect(recheck()).rejects.toThrow("reset");
  });
  it("enforce cannot run jobs without their authenticated admission", async () => {
    vi.mocked(admissions.read).mockRejectedValue(new Error("missing admission"));
    await expect(service.prepare("run", "worker")).rejects.toThrow("missing admission");
  });
});
