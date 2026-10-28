import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { PlatformRelayUptimeReadIamService } from "@/services/relay/platform-relay-uptime-read-iam.service";
import { RelayUptimeService } from "@/services/relay/relay-uptime.service";
import { PlatformRelayConfigurationReadRepository } from "@/store/relay/platform-relay-configuration-read.repository";
import { platformRelayUptimeArn, platformRelayUptimeMonitorArn } from "@/iam/resources/platform-relay-uptime-resources";
import { relayUptimeTargets } from "@/util/relay-uptime-projection";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import * as conditions from "@/iam/request/condition-context";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, configId: string;
const action = "quyan:relay:GetUptimeStatus",
  originalMode = env.security.iamAuthorizationMode,
  service = PlatformRelayUptimeReadIamService.getInstance(),
  reports = RelayUptimeService.getInstance(),
  repository = PlatformRelayConfigurationReadRepository.getInstance();
const monitors = () => ({
  categoryName: "Fixture monitors",
  monitors: [
    { id: "1", name: "Primary", uptime: 99, status: 1 },
    { id: "2", name: "Backup", uptime: 90, status: 0 },
  ],
});
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "uptime-iam-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "*" },
    secure: true,
    ip: "192.0.2.20",
  }) as unknown as TypedRequest;
async function group(accountOwnerId: string | null = null, permission = Permission.UPSTREAM_STATUS_READ) {
  const row = await prisma.group.create({
    data: {
      username: "uptime-iam-" + randomUUID(),
      name: "fixture global",
      level: 0,
      accountOwnerId,
      permissions: [permission],
    },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: row.id } });
  return row;
}
async function bind(
  effect: "Allow" | "Deny",
  resources: string[],
  principalType = "user",
  principalId = actor,
  condition?: Record<string, Record<string, string>>,
) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: effect, Action: action, Resource: resources, ...(condition ? { Condition: condition } : {}) },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "uptime-iam-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  return prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType,
      principalId,
      policyId: policy.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  await prisma.relayConfig.deleteMany();
  owner = await user();
  actor = await user(owner);
  configId = (await prisma.relayConfig.create({ data: { uptimeStaticData: monitors() } })).id;
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
});
describe("persisted monitoring resource authorization", () => {
  it("retains the real global group's baseline grants", async () => {
    await group();
    expect((await service.read(request())).data[0]!.monitors.map((row) => row.id)).toEqual(["1", "2"]);
  });
  it("filters an exact Deny over broad group Allow", async () => {
    await group();
    await bind("Deny", [platformRelayUptimeMonitorArn("2")]);
    expect((await service.read(request())).data[0]!.monitors.map((row) => row.id)).toEqual(["1"]);
  });
  it("does not leak an empty category when all monitor grants are denied", async () => {
    await group();
    await bind("Deny", [platformRelayUptimeMonitorArn("1"), platformRelayUptimeMonitorArn("2")]);
    expect((await service.read(request())).data).toEqual([]);
  });
  it("requires collection access before source hydration", async () => {
    await group();
    await bind("Deny", [platformRelayUptimeArn()]);
    const hydrate = vi.spyOn(repository, "hydrateConfiguration");
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
    expect(hydrate).not.toHaveBeenCalled();
  });
  it.each(["addition", "private", "disabled", "removed", "wrong"])(
    "does not treat %s as global monitoring eligibility",
    async (kind) => {
      if (kind === "addition")
        await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.UPSTREAM_STATUS_READ] } });
      if (kind === "private") await group(owner);
      if (kind === "disabled") {
        const row = await group();
        await prisma.group.update({ where: { id: row.id }, data: { status: 0 } });
      }
      if (kind === "removed") {
        await group();
        await prisma.user.update({ where: { id: actor }, data: { groupId: null } });
      }
      if (kind === "wrong") await group(null, Permission.MODEL_PRICING_UPDATE);
      await bind("Allow", ["*"]);
      await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("does not infer deployment-managed membership from account-owner identity", async () => {
    actor = owner;
    await bind("Allow", ["*"]);
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("keeps a missing configuration absent and returns no configured monitors", async () => {
    await group();
    await prisma.relayConfig.deleteMany();
    expect(await service.read(request())).toMatchObject({ data: [], success: false });
    expect(await prisma.relayConfig.count()).toBe(0);
  });
  it("denies malformed stored configuration instead of expanding the visible monitor set", async () => {
    await group();
    await prisma.relayConfig.update({ where: { id: configId }, data: { monitorNameMapping: ["invalid"] } });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["duplicate", "unsafe", "payload"])("denies ambiguous or invalid %s monitoring data", async (kind) => {
    await group();
    const data = monitors();
    if (kind === "duplicate") data.monitors[1]!.id = "1";
    if (kind === "unsafe") data.monitors[1]!.id = "*";
    if (kind === "payload") (data.monitors[1] as unknown as { uptime: string }).uptime = "bad";
    await prisma.relayConfig.update({ where: { id: configId }, data: { uptimeStaticData: data } });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("assigns deterministic resource identities to legacy static monitors with no IDs", async () => {
    await group();
    const data = { categoryName: "Static", monitors: [{ name: "Legacy", uptime: 100, status: 1 }] };
    await prisma.relayConfig.update({ where: { id: configId }, data: { uptimeStaticData: data } });
    const id = relayUptimeTargets({ data: [data], success: true, message: "fixture" })[0]!.id;
    expect((await service.read(request())).data[0]!.monitors[0]!.id).toBe(id);
    await bind("Deny", [platformRelayUptimeMonitorArn(id)]);
    expect((await service.read(request())).data).toEqual([]);
  });
  it("uses scoped role grants without inheriting the subject user's broad group policies", async () => {
    await group();
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "uptime-role-" + randomUUID() } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await bind("Allow", [platformRelayUptimeArn(), platformRelayUptimeMonitorArn("1")], "role", role.id);
    const req = request();
    Object.assign(req.authContext!, { assumedRoleId: role.id, roleSessionId: session.id });
    expect((await service.read(req)).data[0]!.monitors.map((row) => row.id)).toEqual(["1"]);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.read(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("applies the same exact Deny to AccessKey-authenticated subjects", async () => {
    await group();
    await bind("Deny", [platformRelayUptimeArn()]);
    const req = request();
    Object.assign(req.authContext!, { subjectType: "access_key" });
    await expect(service.read(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["group", "policy", "config"])(
    "rejects %s changes made while fetching the monitoring source",
    async (kind) => {
      const qualified = await group(),
        before = await prisma.relayConfig.findUniqueOrThrow({ where: { id: configId } }),
        original = reports.fromConfiguration.bind(reports);
      vi.spyOn(reports, "fromConfiguration").mockImplementationOnce(async (config) => {
        if (kind === "group")
          await prisma.group.update({
            where: { id: qualified.id },
            data: { permissions: [], updateTime: qualified.updateTime },
          });
        if (kind === "policy") await bind("Deny", [platformRelayUptimeMonitorArn("1")]);
        if (kind === "config")
          await prisma.relayConfig.update({
            where: { id: configId },
            data: { uptimeStaticData: { ...monitors(), categoryName: "Changed" }, updateTime: before.updateTime },
          });
        return original(config);
      });
      await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("checks the source again if it changes during the final grant evaluation", async () => {
    await group();
    const engine = IamAuthorizationService.getInstance(),
      original = engine.authorizeMany.bind(engine);
    let monitorEvaluations = 0;
    vi.spyOn(engine, "authorizeMany").mockImplementation(async (input) => {
      const result = await original(input);
      if (input.resources.includes(platformRelayUptimeMonitorArn("1")) && ++monitorEvaluations === 3)
        await prisma.relayConfig.update({
          where: { id: configId },
          data: { uptimeStaticData: { ...monitors(), categoryName: "Changed at return" } },
        });
      return result;
    });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks real Date conditions after a monitor grant was initially allowed", async () => {
    await group();
    let now = new Date("2026-10-14T00:00:00Z");
    await bind("Deny", [platformRelayUptimeMonitorArn("1")], "user", actor, {
      DateGreaterThanEquals: { "acs:CurrentTime": "2026-10-14T00:00:01Z" },
    });
    vi.spyOn(conditions, "requestConditionContext").mockImplementation((_request, principal) => ({
      ...conditions.principalConditionContext(principal, now),
      "acs:SecureTransport": true,
    }));
    const engine = IamAuthorizationService.getInstance(),
      original = engine.authorizeMany.bind(engine);
    vi.spyOn(engine, "authorizeMany").mockImplementation(async (input) => {
      const result = await original(input);
      if (input.resources.includes(platformRelayUptimeMonitorArn("1"))) now = new Date("2026-10-14T00:00:02Z");
      return result;
    });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("supports more than 500 monitor resources without disclosing denied monitors", async () => {
    await group();
    await prisma.relayConfig.update({
      where: { id: configId },
      data: {
        uptimeStaticData: {
          categoryName: "Many",
          monitors: Array.from({ length: 501 }, (_, index) => ({
            id: String(index),
            name: "Fixture",
            uptime: 99,
            status: 1,
          })),
        },
      },
    });
    await bind("Deny", [platformRelayUptimeMonitorArn("500")]);
    expect((await service.read(request())).data[0]!.monitors).toHaveLength(500);
  });
  it("does not turn storage failure into successful empty defaults", async () => {
    await group();
    vi.spyOn(repository, "configurationTarget").mockRejectedValueOnce(new Error("fixture storage unavailable"));
    await expect(service.read(request())).rejects.toThrow("fixture storage unavailable");
  });
  it.each(["legacy", "shadow"] as const)("preserves a single legacy %s read", async (mode) => {
    await group();
    env.security.iamAuthorizationMode = mode;
    await bind("Deny", [platformRelayUptimeArn()]);
    const report = vi.spyOn(reports, "getStatus");
    expect((await service.read(request())).data[0]!.monitors).toHaveLength(2);
    expect(report).toHaveBeenCalledOnce();
  });
});
