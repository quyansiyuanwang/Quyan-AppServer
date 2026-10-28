import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { RedisService } from "@/services/infrastructure/redis.service";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { PlatformRelayConcurrencyReadIamService } from "@/services/relay/platform-relay-concurrency-read-iam.service";
import { PlatformRelayConcurrencyReadRepository } from "@/store/relay/platform-relay-concurrency-read.repository";
import {
  platformRelayConcurrencyArn,
  platformRelayImageConcurrencyArn,
  platformRelayUserConcurrencyArn,
} from "@/iam/resources/platform-relay-concurrency-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import * as conditions from "@/iam/request/condition-context";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, other: string, configId: string, keys: string[];
const action = "quyan:relay:GetConcurrencyStatus",
  originalMode = env.security.iamAuthorizationMode,
  redis = RedisService.getInstance(),
  service = PlatformRelayConcurrencyReadIamService.getInstance(),
  repository = PlatformRelayConcurrencyReadRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "concurrency-iam-" + randomUUID(),
        password: "fixture-only",
        permissionAdds: [],
        permissionRemoves: [],
        accountOwnerId,
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    secure: true,
    headers: { "x-action": "*" },
    ip: "192.0.2.20",
  }) as unknown as TypedRequest;
async function group(accountOwnerId: string | null = null, permission = Permission.UPSTREAM_STATUS_READ) {
  const row = await prisma.group.create({
    data: {
      username: "concurrency-iam-" + randomUUID(),
      name: "fixture global",
      level: 0,
      permissions: [permission],
      accountOwnerId,
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
    name: "concurrency-iam-" + randomUUID(),
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
const put = async (id: string, kind = "slot", slot = 1, scope = "default") => {
  const key = `relay:concurrency:${scope}:${id}:${kind === "slot" ? "slot" : "queue:waiter"}:${slot}`;
  keys.push(key);
  expect(await redis.setWithResult(key, "fixture", 60)).toBe(true);
  return key;
};
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  keys = [];
  await prisma.relayConfig.deleteMany();
  owner = await user();
  actor = await user(owner);
  other = await user();
  configId = (await prisma.relayConfig.create({ data: { maxConcurrency: 5 } })).id;
  await put(actor);
  await put(actor, "waiter");
  await put(other);
  await put("global", "slot", 1, "image");
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
  if (keys.length) expect(await redis.deleteMany(keys)).not.toBeNull();
});
describe("persisted concurrency resource authorization", () => {
  it("retains baseline global-group eligibility but calculates only existing live resources", async () => {
    await group();
    const result = await service.read(request());
    expect(result).toMatchObject({ page: 1, pageSize: 50, total: 3, hasNext: false, redisAvailable: true });
    expect(result.totals).toMatchObject({
      activeCount: 3,
      defaultScopeActiveCount: 2,
      imageScopeActiveCount: 1,
      queuedCount: 1,
      userCount: 2,
    });
  });
  it("filters an exact user Deny and never reads that user's TTL payloads", async () => {
    await group();
    await bind("Deny", [platformRelayUserConcurrencyArn(other)]);
    const hydrate = vi.spyOn(repository, "ttl"),
      result = await service.read(request());
    expect(result.items.some((row) => row.userId === other)).toBe(false);
    expect(result.totals.userCount).toBe(1);
    expect(hydrate.mock.calls.every(([key]) => !key.includes(other))).toBe(true);
  });
  it("does not scan or expose the global image pool without its independent grant", async () => {
    await group();
    await bind("Deny", [platformRelayImageConcurrencyArn()]);
    const scan = vi.spyOn(repository, "scan");
    const result = await service.read(request(), actor);
    expect(result.items.map((row) => row.userId)).toEqual([actor]);
    expect(result.totals.imageScopeActiveCount).toBe(0);
    expect(scan.mock.calls.every(([scope]) => scope === "default")).toBe(true);
  });
  it("requires collection access before metadata and source hydration", async () => {
    await group();
    await bind("Deny", [platformRelayConcurrencyArn()]);
    const scan = vi.spyOn(repository, "scan");
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
    expect(scan).not.toHaveBeenCalled();
  });
  it("does not answer selected-user queries for unauthorized or missing resources", async () => {
    await group();
    await bind("Deny", [platformRelayUserConcurrencyArn(actor)]);
    await expect(service.read(request(), actor)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.read(request(), "missing-fixture-user")).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["addition", "private", "disabled", "wrong"])("does not infer global eligibility from %s", async (kind) => {
    if (kind === "addition")
      await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.UPSTREAM_STATUS_READ] } });
    if (kind === "private") await group(owner);
    if (kind === "disabled") {
      const row = await group();
      await prisma.group.update({ where: { id: row.id }, data: { status: 0 } });
    }
    if (kind === "wrong") await group(null, Permission.MODEL_PRICING_UPDATE);
    await bind("Allow", ["*"]);
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not disclose stale keys for disabled target accounts", async () => {
    await group();
    await prisma.user.update({ where: { id: other }, data: { status: 0 } });
    const result = await service.read(request());
    expect(result.items.some((row) => row.userId === other)).toBe(false);
  });
  it("provides bounded pages while keeping totals scoped to all admitted rows", async () => {
    await group();
    const first = await service.read(request(), undefined, { page: 1, pageSize: 1 }),
      second = await service.read(request(), undefined, { page: 2, pageSize: 1 });
    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(first.items[0]!.key).not.toBe(second.items[0]!.key);
    expect(first.totals).toEqual(second.totals);
    expect(first.total).toBe(3);
    expect(first.hasNext).toBe(true);
  });
  it("counts more than 500 matching keys without truncation", async () => {
    await group();
    for (let i = 2; i <= 501; i++) await put(actor, "slot", i);
    await bind("Deny", [platformRelayImageConcurrencyArn()]);
    expect((await service.read(request(), actor)).totals.defaultScopeActiveCount).toBe(501);
  });
  it("does not bootstrap configuration through status reads", async () => {
    await group();
    await prisma.relayConfig.deleteMany();
    await service.read(request());
    expect(await prisma.relayConfig.count()).toBe(0);
  });
  it("uses role resources without inheriting the actor's global group Allow", async () => {
    await group();
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "concurrency-role-" + randomUUID() },
    });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await bind("Allow", [platformRelayConcurrencyArn(), platformRelayUserConcurrencyArn(actor)], "role", role.id);
    const req = request();
    Object.assign(req.authContext!, { assumedRoleId: role.id, roleSessionId: session.id });
    expect((await service.read(req)).items.map((row) => row.userId)).toEqual([actor]);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.read(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["policy", "group", "config", "owner"])("rechecks %s changes while reading Redis", async (kind) => {
    const qualified = await group(),
      config = await prisma.relayConfig.findUniqueOrThrow({ where: { id: configId } }),
      before = await prisma.user.findUniqueOrThrow({ where: { id: other } }),
      original = repository.ttl.bind(repository);
    vi.spyOn(repository, "ttl").mockImplementationOnce(async (key) => {
      if (kind === "policy") await bind("Deny", [platformRelayUserConcurrencyArn(actor)]);
      if (kind === "group")
        await prisma.group.update({
          where: { id: qualified.id },
          data: { permissions: [], updateTime: qualified.updateTime },
        });
      if (kind === "config")
        await prisma.relayConfig.update({
          where: { id: configId },
          data: { maxConcurrency: 7, updateTime: config.updateTime },
        });
      if (kind === "owner")
        await prisma.user.update({
          where: { id: other },
          data: { accountOwnerId: owner, updateTime: before.updateTime },
        });
      return original(key);
    });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks real Date conditions for resources after initially allowing their telemetry", async () => {
    await group();
    let now = new Date("2026-10-14T00:00:00Z");
    await bind("Deny", [platformRelayUserConcurrencyArn(actor)], "user", actor, {
      DateGreaterThanEquals: { "acs:CurrentTime": "2026-10-14T00:00:01Z" },
    });
    vi.spyOn(conditions, "requestConditionContext").mockImplementation((_request, principal) => ({
      ...conditions.principalConditionContext(principal, now),
      "acs:SecureTransport": true,
    }));
    const original = repository.ttl.bind(repository);
    vi.spyOn(repository, "ttl").mockImplementationOnce(async (key) => {
      now = new Date("2026-10-14T00:00:02Z");
      return original(key);
    });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects user account changes during the final authorization pass", async () => {
    await group();
    const engine = IamAuthorizationService.getInstance(),
      original = engine.authorizeMany.bind(engine);
    let occurrences = 0;
    vi.spyOn(engine, "authorizeMany").mockImplementation(async (input) => {
      const result = await original(input);
      if (input.resources.includes(platformRelayUserConcurrencyArn(other)) && ++occurrences === 5)
        await prisma.user.update({ where: { id: other }, data: { accountOwnerId: owner } });
      return result;
    });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("returns 503 for an unknown Redis scan rather than a successful zero summary", async () => {
    await group();
    vi.spyOn(redis, "scanKeyPageWithResult").mockResolvedValueOnce(null);
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 503 });
  });
});
