import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelProbeService } from "@/services/relay/relay-channel-probe.service";
import { RelayChannelProbeRepository } from "@/store/relay/relay-channel-probe.repository";
import { RelayProbeRunAdmissionStore } from "@/services/relay/relay-probe-run-admission";
import { RelayProbeRunExecutionRepository } from "@/store/relay/relay-probe-run-execution.repository";
import { RelayProbeRunExecutionIamService } from "@/services/relay/relay-probe-run-execution-iam.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { RedisService } from "@/services/infrastructure/redis.service";
import { relayProbeQueueSlotKey } from "@/services/relay/relay-channel-probe-queue-policy";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import {
  platformRelayProbeProfileArn,
  platformRelayProbeRunArn,
  platformRelayProbeQueueSlotArn,
  platformRelayProbeAccountArn,
} from "@/iam/resources/platform-relay-probe-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { Permission } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode;
let owner: string, actor: string, groupId: string, prefix: string, actorUpdatedAt: string;
let standalone: string, pool: string, member: string, outsider: string, profile: string, poolProfile: string;
let accountId: string | undefined, channelIds: string[], admissionIds: string[];
const redis = () => RedisService.getInstance();
const request = () =>
  ({
    user: { userId: actor, updatedAt: actorUpdatedAt },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "fake:*" },
    secure: true,
    ip: "192.0.2.1",
  }) as unknown as TypedRequest;
const create = (channelId = standalone, memberChannelId?: string) =>
  RelayChannelProbeService.getInstance().createRun(
    channelId,
    memberChannelId ? { memberChannelId } : {},
    actor,
    request(),
  );
const slot = (id = standalone, target?: string) => relayProbeQueueSlotKey(id, target);
async function policy(effect: "Allow" | "Deny", resource: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: effect, Action: "quyan:relay:CreateProbeRun", Resource: resource },
  });
  const created = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: prefix + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: "user",
      principalId: actor,
      policyId: created.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
async function bindAccount() {
  accountId = (
    await prisma.relayChannelProbeAccount.create({
      data: {
        name: prefix,
        tokenPath: "data.token",
        fallbackTtlSeconds: 30,
        minLoginIntervalSeconds: 60,
        encryptedCredentials: "fixture-account-ciphertext",
        credentialIv: "fixture-iv",
        credentialAuthTag: "fixture-tag",
      },
    })
  ).id;
  await prisma.relayChannelProbeTargetConfig.create({
    data: { profileId: profile, targetChannelId: standalone, accountId },
  });
  return accountId;
}
async function claim(id: string) {
  await prisma.relayChannelProbeRun.update({
    where: { id },
    data: { status: "running", leaseOwner: "fixture-worker", leaseExpiresAt: new Date(Date.now() + 60_000) },
  });
  return RelayProbeRunExecutionIamService.getInstance().prepare(id, "fixture-worker");
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  prefix = "probe-run-create-" + randomUUID();
  channelIds = [];
  admissionIds = [];
  accountId = undefined;
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: prefix + randomUUID(),
          password: "fixture-only",
          accountOwnerId,
          parentUserId: accountOwnerId,
          userType: accountOwnerId ? "ram_user" : "root",
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;
  owner = await user();
  actor = await user(owner);
  groupId = (
    await prisma.group.create({
      data: {
        username: prefix,
        name: "Fixture probe executor",
        accountOwnerId: null,
        permissions: [Permission.RELAY_CHANNEL_PROBE_EXECUTE],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  actorUpdatedAt = (
    await prisma.user.findUniqueOrThrow({ where: { id: actor }, select: { updateTime: true } })
  ).updateTime.toISOString();
  const channel = async (data: Partial<Prisma.RelayChannelUncheckedCreateInput> = {}) => {
    const row = await prisma.relayChannel.create({
      data: {
        name: prefix,
        openaiUpstreamUrl: "https://fixture.invalid",
        openaiUpstreamApiKey: "fixture-private-upstream",
        ...data,
      },
    });
    channelIds.push(row.id);
    return row.id;
  };
  standalone = await channel();
  pool = await channel({ channelType: "pooled" });
  member = await channel({ pooledParentId: pool });
  outsider = await channel();
  const makeProfile = async (relayChannelId: string) =>
    (
      await prisma.relayChannelProbeProfile.create({
        data: {
          relayChannelId,
          probeModel: "fixture-model",
          probePayload: {},
          workflow: [],
          encryptedCredentials: "fixture-never-decrypt",
          credentialIv: "fixture-iv",
          credentialAuthTag: "fixture-tag",
        },
      })
    ).id;
  profile = await makeProfile(standalone);
  poolProfile = await makeProfile(pool);
  const admissions = RelayProbeRunAdmissionStore.getInstance(),
    save = admissions.save.bind(admissions);
  vi.spyOn(admissions, "save").mockImplementation((input) => {
    admissionIds.push(input.runId);
    return save(input);
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await Promise.all(admissionIds.map((id) => redis().delete(`relay:probe-run-admission:v1:${id}`)));
  await Promise.all(
    channelIds.flatMap((id) => [undefined, ...channelIds].map((target) => redis().delete(slot(id, target)))),
  );
  await prisma.relayChannelProbeRun.deleteMany({ where: { relayChannelId: { in: channelIds } } });
  await prisma.relayChannelMember.deleteMany({ where: { relayChannelId: { in: channelIds } } });
  await prisma.relayChannel.updateMany({ where: { id: { in: channelIds } }, data: { pooledParentId: null } });
  await prisma.relayChannel.deleteMany({ where: { id: { in: channelIds } } });
  if (accountId) await prisma.relayChannelProbeAccount.deleteMany({ where: { id: accountId } });
  await prisma.accessKey.deleteMany({ where: { userId: { in: [actor, owner] } } });
  await prisma.user.deleteMany({ where: { id: { in: [actor, owner] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});
describe("probe creation and worker admission authorization", () => {
  it("creates the server-reserved run and binds exact queue/admission identity without exposing secrets", async () => {
    const result = await create();
    expect(await redis().get(slot())).toBe(result.id);
    expect(await RelayProbeRunAdmissionStore.getInstance().read(result.id)).toMatchObject({
      runId: result.id,
      channelId: standalone,
      profileId: profile,
      principal: { subjectUserId: actor, accountOwnerId: owner },
      transport: { "acs:SecureTransport": true, "acs:SourceIp": "192.0.2.1" },
    });
    expect(JSON.stringify(result)).not.toContain("fixture-never-decrypt");
    expect(result).not.toHaveProperty("principal");
    expect(result).not.toHaveProperty("encryptedCredentials");
  });
  it.each(["channel", "profile", "run", "slot"])(
    "rejects explicit deny on related %s resources before creating a row",
    async (kind) => {
      const resource =
        kind === "channel"
          ? platformRelayChannelArn(standalone)
          : kind === "profile"
            ? platformRelayProbeProfileArn(standalone, profile)
            : kind === "run"
              ? platformRelayProbeRunArn(standalone, "fixture").replace(/fixture$/, "*")
              : platformRelayProbeQueueSlotArn(standalone);
      await policy("Deny", resource);
      await expect(create()).rejects.toMatchObject({ statusCode: 403 });
      expect(await prisma.relayChannelProbeRun.count({ where: { relayChannelId: standalone } })).toBe(0);
      expect(await redis().get(slot())).toBeNull();
    },
  );
  it("authorizes the exact future run id instead of any run in the collection", async () => {
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam),
      observed: string[] = [];
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      observed.push(...input.resources);
      return original(input);
    });
    const result = await create();
    expect(observed).toContain(platformRelayProbeRunArn(standalone, result.id));
    expect(observed).not.toContain(platformRelayProbeRunArn(standalone, "fixture").replace(/fixture$/, "*"));
  });
  it("requires the exact physical member and never falls back to legacy membership", async () => {
    await prisma.relayChannelMember.create({ data: { relayChannelId: pool, memberChannelId: outsider, priority: 0 } });
    await expect(create(pool, outsider)).rejects.toMatchObject({ statusCode: 403 });
    await policy("Deny", platformRelayChannelArn(member));
    await expect(create(pool, member)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.relayChannelProbeRun.count({ where: { relayChannelId: pool } })).toBe(0);
  });
  it("does not accept disabled legacy-only members", async () => {
    await prisma.relayChannel.update({ where: { id: member }, data: { pooledParentId: null } });
    await prisma.relayChannelMember.create({
      data: { relayChannelId: pool, memberChannelId: member, priority: 0, enabled: false },
    });
    await expect(create(pool, member)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("creates an authorized pooled target with its own profile, member and queue identity", async () => {
    const result = await create(pool, member);
    expect(await redis().get(slot(pool, member))).toBe(result.id);
    expect(await RelayProbeRunAdmissionStore.getInstance().read(result.id)).toMatchObject({
      memberChannelId: member,
      profileId: poolProfile,
    });
  });
  it("executes an allowed bound account without granting account-management permission", async () => {
    const id = await bindAccount();
    const result = await create();
    expect(await RelayProbeRunAdmissionStore.getInstance().read(result.id)).toMatchObject({ accountId: id });
    await expect(claim(result.id)).resolves.toBeTypeOf("function");
  });
  it("rejects a bound account deny before admission or login", async () => {
    const id = await bindAccount();
    await policy("Deny", platformRelayProbeAccountArn(id));
    await expect(create()).rejects.toMatchObject({ statusCode: 403 });
    expect(admissionIds).toHaveLength(0);
  });
  it("does not persist if queue or admission storage is unavailable", async () => {
    vi.spyOn(RelayProbeRunAdmissionStore.getInstance(), "save").mockRejectedValue(new Error("fixture unavailable"));
    await expect(create()).rejects.toThrow("fixture unavailable");
    expect(await redis().get(slot())).toBeNull();
    expect(await prisma.relayChannelProbeRun.count({ where: { relayChannelId: standalone } })).toBe(0);
  });
  it("preserves an existing reservation and cannot overwrite it", async () => {
    await redis().set(slot(), "fixture-newer-reservation", 60);
    await expect(create()).rejects.toMatchObject({ statusCode: 409 });
    expect(await redis().get(slot())).toBe("fixture-newer-reservation");
    expect(admissionIds).toHaveLength(0);
  });
  it("rolls back row/admission/slot when the final policy check is revoked", async () => {
    const admissions = RelayProbeRunAdmissionStore.getInstance(),
      save = vi.mocked(admissions.save).getMockImplementation()!;
    let revoked = false;
    vi.spyOn(admissions, "save").mockImplementation(async (input) => {
      const undo = await save(input);
      revoked = true;
      return undo;
    });
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    vi.spyOn(iam, "authorizeMany").mockImplementation((input) =>
      revoked
        ? Promise.resolve(
            input.resources.map(() => ({ decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] })),
          )
        : original(input),
    );
    await expect(create()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.relayChannelProbeRun.count({ where: { relayChannelId: standalone } })).toBe(0);
    expect(await redis().get(slot())).toBeNull();
    for (const id of admissionIds) expect(await redis().get(`relay:probe-run-admission:v1:${id}`)).toBeNull();
  });
  it("failed admission cleanup never removes a concurrently replaced queue value", async () => {
    vi.spyOn(RelayProbeRunAdmissionStore.getInstance(), "save").mockImplementation(async () => {
      await redis().set(slot(), "fixture-newer-value", 60);
      throw new Error("fixture refused");
    });
    await expect(create()).rejects.toThrow("fixture refused");
    expect(await redis().get(slot())).toBe("fixture-newer-value");
  });
  it("requires authenticated server context and deployment executor membership", async () => {
    await expect(RelayChannelProbeService.getInstance().createRun(standalone, {}, actor)).rejects.toMatchObject({
      statusCode: 403,
    });
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await policy("Allow", "*");
    await expect(create()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("shadow performs preview without admission writes then persists exactly once using the reserved id", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const legacy = vi.spyOn(RelayChannelProbeRepository.getInstance(), "createRun");
    const result = await create();
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(legacy).toHaveBeenCalledWith(expect.objectContaining({ id: result.id }));
    expect(admissionIds).toEqual([result.id]);
  });
  it("worker denies config drift and revoked identities before reading full profiles", async () => {
    const result = await create(),
      recheck = await claim(result.id);
    await prisma.relayChannelProbeProfile.update({ where: { id: profile }, data: { probeModel: "changed-model" } });
    await expect(recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("worker rechecks current policies and stops after reset", async () => {
    const result = await create(),
      recheck = await claim(result.id);
    await policy("Deny", platformRelayChannelArn(standalone));
    await expect(recheck()).rejects.toMatchObject({ statusCode: 403 });
    await prisma.relayChannelProbeRun.update({
      where: { id: result.id },
      data: { status: "cancelled", leaseOwner: null },
    });
    await expect(recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("worker metadata inspection rejects mismatched admissions and lost leases", async () => {
    const result = await create();
    await claim(result.id);
    const input = await RelayProbeRunAdmissionStore.getInstance().read(result.id),
      repository = RelayProbeRunExecutionRepository.getInstance();
    await expect(
      repository.inspect(result.id, "fixture-worker", { ...input, channelId: outsider }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(repository.inspect(result.id, "other-worker", input)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.relayChannelProbeRun.update({ where: { id: result.id }, data: { leaseExpiresAt: new Date(0) } });
    await expect(repository.inspect(result.id, "fixture-worker", input)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("worker detects changed target account binding", async () => {
    await bindAccount();
    const result = await create(),
      recheck = await claim(result.id);
    await prisma.relayChannelProbeTargetConfig.updateMany({ where: { profileId: profile }, data: { accountId: null } });
    await expect(recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("enforce refuses legacy jobs without authenticated worker admission", async () => {
    env.security.iamAuthorizationMode = "legacy";
    const result = await create();
    env.security.iamAuthorizationMode = "enforce";
    await expect(claim(result.id)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("the worker refuses a denied admission before reading full workflow/credentials and cancels only its own claim", async () => {
    const result = await create();
    await claim(result.id);
    await policy("Deny", platformRelayChannelArn(standalone));
    const repository = RelayChannelProbeRepository.getInstance(),
      fullRead = vi.spyOn(repository, "findRunWithProfile");
    const worker = RelayChannelProbeService.getInstance() as unknown as {
      executeRun(id: string, owner: string): Promise<void>;
    };
    await worker.executeRun(result.id, "fixture-worker");
    expect(fullRead).not.toHaveBeenCalled();
    expect((await prisma.relayChannelProbeRun.findUniqueOrThrow({ where: { id: result.id } })).status).toBe(
      "cancelled",
    );
    expect(await redis().get(slot())).toBeNull();
  });
  it("a stale worker cannot cancel the new owner or remove its live queue reservation", async () => {
    const result = await create();
    await claim(result.id);
    await prisma.relayChannelProbeRun.update({ where: { id: result.id }, data: { leaseOwner: "new-worker" } });
    const worker = RelayChannelProbeService.getInstance() as unknown as {
      executeRun(id: string, owner: string): Promise<void>;
    };
    await worker.executeRun(result.id, "fixture-worker");
    expect((await prisma.relayChannelProbeRun.findUniqueOrThrow({ where: { id: result.id } })).leaseOwner).toBe(
      "new-worker",
    );
    expect(await redis().get(slot())).toBe(result.id);
  });
  it("worker refuses identity changes that happened while queued, not only changes after execution starts", async () => {
    const result = await create();
    await prisma.user.update({ where: { id: actor }, data: { updateTime: new Date(Date.now() + 10_000) } });
    await expect(claim(result.id)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["disable", "expire", "rotate", "reassign", "delete"])(
    "queued AccessKey work stops after key %s",
    async (kind) => {
      const key = await prisma.accessKey.create({ data: { userId: actor, key: prefix + randomUUID() } });
      const req = {
        ...request(),
        accessKey: { id: key.id },
        authContext: { ...request().authContext, subjectType: "access_key" },
      } as unknown as TypedRequest;
      const result = await RelayChannelProbeService.getInstance().createRun(standalone, {}, actor, req);
      const recheck = await claim(result.id);
      if (kind === "delete") await prisma.accessKey.delete({ where: { id: key.id } });
      else
        await prisma.accessKey.update({
          where: { id: key.id },
          data:
            kind === "disable"
              ? { status: 0 }
              : kind === "expire"
                ? { expiresAt: new Date(0) }
                : kind === "rotate"
                  ? { key: prefix + randomUUID() }
                  : { userId: owner },
        });
      await expect(recheck()).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("AccessKey usage statistics do not revoke an admitted task", async () => {
    const key = await prisma.accessKey.create({ data: { userId: actor, key: prefix + randomUUID() } });
    const req = {
      ...request(),
      accessKey: { id: key.id },
      authContext: { ...request().authContext, subjectType: "access_key" },
    } as unknown as TypedRequest;
    const result = await RelayChannelProbeService.getInstance().createRun(standalone, {}, actor, req);
    const recheck = await claim(result.id);
    await prisma.accessKey.update({
      where: { id: key.id },
      data: { requestCount: { increment: 1 }, lastUsedAt: new Date() },
    });
    await expect(recheck()).resolves.toBeUndefined();
  });
  it("does not admit AccessKey principals without a current server-authenticated key identity", async () => {
    const req = request();
    req.authContext!.subjectType = "access_key";
    await expect(RelayChannelProbeService.getInstance().createRun(standalone, {}, actor, req)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await redis().get(slot())).toBeNull();
  });
  it("cannot queue work from an invalidated JWT snapshot or an impersonation session", async () => {
    const req = request();
    req.user!.updatedAt = new Date(0).toISOString();
    await expect(RelayChannelProbeService.getInstance().createRun(standalone, {}, actor, req)).rejects.toMatchObject({
      statusCode: 403,
    });
    req.user!.updatedAt = actorUpdatedAt;
    req.user!.impersonatorId = owner;
    await expect(RelayChannelProbeService.getInstance().createRun(standalone, {}, actor, req)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await redis().get(slot())).toBeNull();
  });
  it("batch explicit targets propagate authenticated worker admissions and deduplicate against expanded channels", async () => {
    const result = await RelayChannelProbeService.getInstance().createRuns(
      {
        channelIds: [standalone, pool],
        targets: [{ channelId: standalone }, { channelId: pool, memberChannelId: member }],
      },
      actor,
      request(),
    );
    expect(result.rejected).toEqual([]);
    expect(result.queued).toHaveLength(2);
    for (const row of result.queued)
      expect(await RelayProbeRunAdmissionStore.getInstance().read(row.id)).toMatchObject({
        runId: row.id,
        principal: { subjectUserId: actor },
      });
    expect(await prisma.relayChannelProbeRun.count({ where: { relayChannelId: { in: [standalone, pool] } } })).toBe(2);
  });
  it("batch independently refuses denied targets without blocking authorized resources or leaking policy details", async () => {
    await policy("Deny", platformRelayChannelArn(member));
    const result = await RelayChannelProbeService.getInstance().createRuns(
      { targets: [{ channelId: pool, memberChannelId: member }, { channelId: standalone }] },
      actor,
      request(),
    );
    expect(result.queued).toHaveLength(1);
    expect(result.queued[0]!.relayChannelId).toBe(standalone);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({ channelId: pool, memberChannelId: member });
    expect(JSON.stringify(result.rejected)).not.toContain("Deny");
    expect(JSON.stringify(result.rejected)).not.toContain("policy");
  });
  it("batch native discovery never loads full channel configuration", async () => {
    const full = vi.spyOn(
      (await import("@/services/relay/relay-channel.service")).RelayChannelService.getInstance(),
      "getChannel",
    );
    const profileRead = vi.spyOn(RelayChannelProbeRepository.getInstance(), "findProfileWithChannel");
    const result = await RelayChannelProbeService.getInstance().createRuns({ channelIds: [pool] }, actor, request());
    expect(result.queued).toHaveLength(1);
    expect(full).not.toHaveBeenCalled();
    expect(profileRead).not.toHaveBeenCalled();
    expect(result.queued[0]!.probeMemberChannelId).toBe(member);
  });
  it("batch discovery excludes denied strict members and never exposes a fallback legacy member", async () => {
    await prisma.relayChannelMember.create({ data: { relayChannelId: pool, memberChannelId: outsider, priority: 0 } });
    await policy("Deny", platformRelayChannelArn(member));
    const result = await RelayChannelProbeService.getInstance().createRuns({ channelIds: [pool] }, actor, request());
    expect(result.queued).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(outsider);
    expect(admissionIds).toHaveLength(0);
  });
  it("batch discovery does not fall back when strict topology contains only disabled members", async () => {
    await prisma.relayChannel.update({ where: { id: member }, data: { pooledMemberEnabled: false } });
    await prisma.relayChannelMember.create({ data: { relayChannelId: pool, memberChannelId: outsider, priority: 0 } });
    const result = await RelayChannelProbeService.getInstance().createRuns({ channelIds: [pool] }, actor, request());
    expect(result.queued).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(admissionIds).toHaveLength(0);
  });
  it("batch discovery supports enabled legacy members only when no strict topology exists", async () => {
    await prisma.relayChannel.update({ where: { id: member }, data: { pooledParentId: null } });
    await prisma.relayChannelMember.create({ data: { relayChannelId: pool, memberChannelId: member, priority: 0 } });
    const result = await RelayChannelProbeService.getInstance().createRuns({ channelIds: [pool] }, actor, request());
    expect(result.queued).toHaveLength(1);
    expect(result.queued[0]!.probeMemberChannelId).toBe(member);
  });
  it("batch rejects missing context and invalid input before discovering channels", async () => {
    const service = RelayChannelProbeService.getInstance();
    await expect(service.createRuns({ channelIds: [pool] }, actor)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.createRuns({ targets: [] }, actor, request())).rejects.toMatchObject({ statusCode: 400 });
    expect(admissionIds).toHaveLength(0);
  });
  it("batch shadow discovery does not create duplicate admissions or duplicate rows", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const legacy = vi.spyOn(RelayChannelProbeRepository.getInstance(), "createRun");
    const result = await RelayChannelProbeService.getInstance().createRuns(
      { channelIds: [standalone], targets: [{ channelId: standalone }] },
      actor,
      request(),
    );
    expect(result.queued).toHaveLength(1);
    expect(result.rejected).toEqual([]);
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(admissionIds).toEqual([result.queued[0]!.id]);
  });
  it("batch overflow is detected before reserving any queue slot", async () => {
    const targets = Array.from({ length: 200 }, (_, index) => ({ channelId: `fixture-target-${index}` }));
    await expect(
      RelayChannelProbeService.getInstance().createRuns({ channelIds: [standalone], targets }, actor, request()),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(admissionIds).toHaveLength(0);
    expect(await redis().get(slot())).toBeNull();
  });
});
