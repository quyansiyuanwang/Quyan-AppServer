import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayTokenService } from "@/services/relay/relay-token.service";
import { PlatformRelayRequestReadRepository } from "@/store/relay/platform-relay-request-read.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformRelayRequestArn } from "@/iam/resources/platform-relay-request-resources";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode;
const required = [
  Permission.RELAY_REQUEST_DIAGNOSTICS_READ,
  Permission.RELAY_REQUEST_ROUTE_TRACE_READ,
  Permission.RELAY_CHANNEL_POOL_METADATA_READ,
];
const listAction = "quyan:relay:ListRequestDiagnostics",
  traceAction = "quyan:relay:GetRequestRouteTrace",
  poolAction = "quyan:relay:ReadChannelPoolMetadata";
let owner: string,
  actor: string,
  foreign: string,
  group: string,
  first: string,
  second: string,
  firstToken: string,
  secondToken: string,
  channel: string,
  requestId: string,
  prefix: string;
const repo = () => PlatformRelayRequestReadRepository.getInstance();
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "fake:*" },
    ip: "127.0.0.1",
    secure: true,
  }) as unknown as TypedRequest;
const list = (query = {}, req: TypedRequest | undefined = request()) =>
  new RelayTokenService().getRequestDiagnostics(actor, query, req);
const trace = (id = requestId, req: TypedRequest | undefined = request()) =>
  new RelayTokenService().getRequestRouteTrace(actor, id, req);
async function grant(
  Action: string,
  Resource: string,
  Effect: "Allow" | "Deny" = "Deny",
  target: { type: "user" | "role"; id: string } = { type: "user", id: actor },
) {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Action, Resource, Effect } });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: prefix + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: target.type,
      principalId: target.id,
      policyId: policy.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
async function oauth(scopes = ["relay:usage:read"]) {
  const client = await prisma.oAuthClient.create({
    data: {
      userId: actor,
      clientId: prefix + randomUUID(),
      name: prefix,
      clientSecretHash: "fixture-hash",
      grantTypes: ["authorization_code"],
      redirectUris: [],
      scopes,
      reviewStatus: "approved",
    },
  });
  const token = await prisma.oAuthAccessToken.create({
    data: {
      userId: actor,
      oauthClientId: client.id,
      tokenHash: randomUUID(),
      scopes,
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  return {
    ...request(),
    oauthAccessToken: {
      id: token.id,
      oauthClientId: client.id,
      clientId: client.clientId,
      clientName: prefix,
      userId: actor,
      scopes,
      expiresAt: token.expiresAt.toISOString(),
    },
  } as TypedRequest;
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  prefix = "request-iam-" + randomUUID();
  requestId = randomUUID();
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
  foreign = await user();
  group = (
    await prisma.group.create({ data: { name: prefix, username: prefix, accountOwnerId: null, permissions: required } })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId: group } });
  const token = async (userId: string) =>
    (
      await prisma.relayToken.create({
        data: {
          userId,
          name: prefix,
          token: "sk-rlt-fixture-" + randomUUID(),
          upstreamApiKey: "fixture-upstream-secret",
        },
      })
    ).id;
  firstToken = await token(actor);
  secondToken = await token(foreign);
  first = (
    await prisma.relayLogicalRequest.create({
      data: { relayTokenId: firstToken, requestId, createTime: new Date("2026-10-15T12:00:00Z") },
    })
  ).id;
  second = (
    await prisma.relayLogicalRequest.create({
      data: { relayTokenId: secondToken, requestId: randomUUID(), createTime: new Date("2026-10-15T13:00:00Z") },
    })
  ).id;
  channel = (await prisma.relayChannel.create({ data: { name: prefix, channelType: "openaiUpstream" } })).id;
  const usage = await prisma.relayUsage.create({
    data: {
      relayTokenId: firstToken,
      logicalRequestId: first,
      executionChannelId: channel,
      path: "/v1/chat/completions",
      method: "POST",
      statusCode: 200,
      ipAddress: "127.0.0.1",
      totalTokens: 12,
    },
  });
  await prisma.relayUsageTokenAttribution.create({
    data: { relayUsageId: usage.id, relayTokenId: firstToken, logicalRequestId: first, depth: 0 },
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.relayUsageTokenAttribution.deleteMany({ where: { relayTokenId: { in: [firstToken, secondToken] } } });
  await prisma.relayUsage.deleteMany({ where: { relayTokenId: { in: [firstToken, secondToken] } } });
  await prisma.relayLogicalRequest.deleteMany({ where: { relayTokenId: { in: [firstToken, secondToken] } } });
  await prisma.relayToken.deleteMany({ where: { userId: { in: [actor, foreign] } } });
  await prisma.relayChannel.deleteMany({ where: { name: prefix } });
  await prisma.accessKey.deleteMany({ where: { userId: actor } });
  await prisma.oAuthAccessToken.deleteMany({ where: { userId: actor } });
  await prisma.oAuthClient.deleteMany({ where: { userId: actor } });
  await prisma.ramRoleSession.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRole.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.user.deleteMany({ where: { id: { in: [actor, foreign, owner] } } });
  await prisma.group.deleteMany({ where: { id: group } });
});
describe("platform resource-authorized relay diagnostics", () => {
  it("deduplicates root-attributed attempts and does not select secrets, physical channel IDs or IP addresses", async () => {
    const read = vi.spyOn(prisma.relayLogicalRequest, "findUnique");
    const result = await list();
    expect(result.total).toBe(2);
    expect(result.records[0]!.resourceArn).toBe(platformRelayRequestArn(second));
    expect(result.records.find((row) => row.requestId === requestId)?.attempts).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/fixture-upstream-secret|executionChannel|ipAddress|tokenAttributions/);
    const select = read.mock.calls[0]![0].select!;
    expect(select.relayToken).not.toHaveProperty("select.token");
    expect(select.relayToken).not.toHaveProperty("select.upstreamApiKey");
    expect(select.relayUsages).not.toHaveProperty("select.executionChannelId");
    expect(select.relayUsages).not.toHaveProperty("select.ipAddress");
  });
  it("filters Deny before hydration, counting or pagination", async () => {
    await grant(listAction, platformRelayRequestArn(second));
    const hydrate = vi.spyOn(repo(), "hydrate");
    const result = await list({ pageSize: 1 });
    expect(result).toMatchObject({ total: 1, records: [{ resourceArn: platformRelayRequestArn(first) }] });
    expect(hydrate.mock.calls.every(([target]) => target.id === first)).toBe(true);
  });
  it("returns an empty page without rich reads when all rows are denied", async () => {
    await grant(listAction, "*");
    const hydrate = vi.spyOn(repo(), "hydrate");
    expect(await list()).toMatchObject({ total: 0, records: [] });
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("supports JSON-only scoped decisions while retaining the persisted platform ceiling", async () => {
    const parsed = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: listAction, Resource: platformRelayRequestArn(first) },
    });
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockResolvedValue([
      { policyId: "fixture-json-only", document: parsed.document },
    ]);
    expect(await list()).toMatchObject({ total: 1, records: [{ resourceArn: platformRelayRequestArn(first) }] });
  });
  it("does not let a wildcard account policy create global operator membership", async () => {
    await prisma.group.update({ where: { id: group }, data: { accountOwnerId: owner } });
    await grant(listAction, "*", "Allow");
    const read = vi.spyOn(repo(), "scan");
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
  });
  it("honors filters and post-filter pagination for cross-account history", async () => {
    expect(await list({ outcome: "success" })).toMatchObject({ total: 1, records: [{ requestId }] });
    expect(await list({ page: 2, pageSize: 1 })).toMatchObject({ total: 2, records: [{ requestId }] });
    expect(await list({ startDate: "2026-10-15T12:30:00Z" })).toMatchObject({
      total: 1,
      records: [{ resourceArn: platformRelayRequestArn(second) }],
    });
    expect(await list({ requestId: requestId.slice(0, 10) })).toMatchObject({ total: 1 });
    expect(await list({ outcome: "client-error" })).toMatchObject({ total: 0 });
  });
  it("keeps historical records for disabled and deleted tokens", async () => {
    await prisma.relayToken.update({ where: { id: firstToken }, data: { status: -1 } });
    await prisma.relayToken.update({ where: { id: secondToken }, data: { status: 0 } });
    expect((await list()).total).toBe(2);
  });
  it("chunks scans and evaluations across the 500-resource boundary", async () => {
    await prisma.relayLogicalRequest.createMany({
      data: Array.from({ length: 501 }, () => ({ relayTokenId: firstToken, requestId: randomUUID() })),
    });
    await grant(listAction, platformRelayRequestArn(second));
    const decisions = vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany");
    expect(await list({ pageSize: 100 })).toMatchObject({ total: 502, records: expect.any(Array) });
    expect(Math.max(...decisions.mock.calls.map(([input]) => input.resources.length))).toBeLessThanOrEqual(500);
  });
  it.each([
    { page: 0 },
    { pageSize: 101 },
    { outcome: "invalid" },
    { unknown: "x" },
    { startDate: "bad" },
    { startDate: "2026-10-16", endDate: "2026-10-15" },
  ])("rejects malformed service-level query %j", async (query) => {
    const scan = vi.spyOn(repo(), "scan");
    await expect(list(query)).rejects.toMatchObject({ statusCode: 400 });
    expect(scan).not.toHaveBeenCalled();
  });
  it("discards a page when its source changes during projection", async () => {
    const original = repo().hydrate.bind(repo());
    let changed = false;
    vi.spyOn(repo(), "hydrate").mockImplementation(async (...args) => {
      const data = await original(...args);
      if (!changed) {
        changed = true;
        await prisma.relayToken.update({ where: { id: firstToken }, data: { name: "changed" } });
      }
      return data;
    });
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("discards a page when its final IAM decision is revoked", async () => {
    const original = repo().hydrate.bind(repo());
    vi.spyOn(repo(), "hydrate").mockImplementation(async (...args) => {
      const data = await original(...args);
      vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany").mockImplementation(async (input) =>
        input.resources.map(() => ({ decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] })),
      );
      return data;
    });
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks the persisted platform group after hydration", async () => {
    const original = repo().hydrate.bind(repo());
    let changed = false;
    vi.spyOn(repo(), "hydrate").mockImplementation(async (...args) => {
      const data = await original(...args);
      if (!changed) {
        changed = true;
        await prisma.group.update({ where: { id: group }, data: { permissions: [] } });
      }
      return data;
    });
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
  });
});
describe("privileged relay request route traces", () => {
  it("requires request-level grants and channel-level pool metadata grants without selecting upstream configuration", async () => {
    const read = vi.spyOn(prisma.relayChannel, "findMany");
    const result = await trace();
    expect(result).toMatchObject({
      resourceArn: platformRelayRequestArn(first),
      requestId,
      attempts: [{ executionChannelId: channel, executionChannelName: prefix, totalTokens: 12 }],
    });
    expect(JSON.stringify(result)).not.toMatch(/fixture-upstream-secret|ipAddress|apiKey|baseUrl/);
    expect(read.mock.calls[0]![0]!.select).toEqual({ id: true, name: true, status: true, updateTime: true });
  });
  it.each([listAction, traceAction])("denies %s before loading attempts", async (action) => {
    await grant(action, platformRelayRequestArn(first));
    const hydrate = vi.spyOn(repo(), "hydrate");
    await expect(trace()).rejects.toMatchObject({ statusCode: 403 });
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("denies physical channel names before querying channel metadata", async () => {
    await grant(poolAction, platformRelayChannelArn(channel));
    const read = vi.spyOn(prisma.relayChannel, "findMany");
    await expect(trace()).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
  });
  it.each(required)("requires each persisted platform ceiling independently: %s", async (permission) => {
    await prisma.group.update({
      where: { id: group },
      data: { permissions: required.filter((value) => value !== permission) },
    });
    await grant("quyan:relay:*", "*", "Allow");
    const read = vi.spyOn(repo(), "traceTarget");
    await expect(trace()).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
  });
  it("does not pick an authorized child when the authoritative root is denied", async () => {
    await prisma.relayLogicalRequest.update({ where: { id: second }, data: { requestId } });
    await grant(traceAction, platformRelayRequestArn(first));
    await expect(trace()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails safely for missing or case-aliased request labels", async () => {
    await expect(trace("missing")).rejects.toMatchObject({ statusCode: 403 });
    await expect(trace(requestId.toUpperCase())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails safely if more than one authoritative root has the same label", async () => {
    await prisma.relayLogicalRequest.update({ where: { id: second }, data: { requestId } });
    const usage = await prisma.relayUsage.create({
      data: {
        relayTokenId: secondToken,
        logicalRequestId: second,
        path: "/v1/chat/completions",
        method: "POST",
        statusCode: 200,
        ipAddress: "127.0.0.1",
      },
    });
    await prisma.relayUsageTokenAttribution.create({
      data: { relayUsageId: usage.id, relayTokenId: secondToken, logicalRequestId: second, depth: 0 },
    });
    await expect(trace()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects an ambiguous label when no authoritative root exists", async () => {
    await prisma.relayUsageTokenAttribution.deleteMany({ where: { logicalRequestId: first } });
    await prisma.relayLogicalRequest.update({ where: { id: second }, data: { requestId } });
    await expect(trace()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("discards a trace when execution channel metadata changes before release", async () => {
    const original = repo().channels.bind(repo());
    let changed = false;
    vi.spyOn(repo(), "channels").mockImplementation(async (...args) => {
      const rows = await original(...args);
      if (!changed) {
        changed = true;
        await prisma.relayChannel.update({ where: { id: channel }, data: { name: "changed" } });
      }
      return rows;
    });
    await expect(trace()).rejects.toMatchObject({ statusCode: 403 });
  });
});
describe("diagnostic identity and rollout proofs", () => {
  it("requires a trusted request in enforce", async () => {
    await expect(new RelayTokenService().getRequestDiagnostics(actor, {})).rejects.toMatchObject({ statusCode: 403 });
    await expect(new RelayTokenService().getRequestRouteTrace(actor, requestId)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("rejects request rebinding during asynchronous authority checks", async () => {
    const req = request(),
      original = repo().scan.bind(repo());
    vi.spyOn(repo(), "scan").mockImplementation(async (...args) => {
      const rows = await original(...args);
      req.authContext!.accountOwnerId = foreign;
      return rows;
    });
    await expect(list({}, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["actor", "owner", "group"])("rejects disabled %s authority before scanning", async (kind) => {
    if (kind === "group") await prisma.group.update({ where: { id: group }, data: { status: 0 } });
    else await prisma.user.update({ where: { id: kind === "actor" ? actor : owner }, data: { status: 0 } });
    const scan = vi.spyOn(repo(), "scan");
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
    expect(scan).not.toHaveBeenCalled();
  });
  it("uses role-session policies, then denies a session revoked during projection", async () => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: prefix } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const req = request();
    req.authContext!.assumedRoleId = role.id;
    req.authContext!.roleSessionId = session.id;
    expect(await list({}, req)).toMatchObject({ total: 0 });
    await grant(listAction, platformRelayRequestArn(first), "Allow", { type: "role", id: role.id });
    expect(await list({}, req)).toMatchObject({ total: 1 });
    const original = repo().hydrate.bind(repo());
    let changed = false;
    vi.spyOn(repo(), "hydrate").mockImplementation(async (...args) => {
      const data = await original(...args);
      if (!changed) {
        changed = true;
        await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      }
      return data;
    });
    await expect(list({}, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects an expired OAuth token before scanning", async () => {
    const req = await oauth();
    await prisma.oAuthAccessToken.update({ where: { id: req.oauthAccessToken!.id }, data: { expiresAt: new Date(0) } });
    const scan = vi.spyOn(repo(), "scan");
    await expect(list({}, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(scan).not.toHaveBeenCalled();
  });
  it("accepts persisted legacy usage OAuth scope but rechecks revocation", async () => {
    const req = await oauth();
    expect((await list({}, req)).total).toBe(2);
    await prisma.oAuthAccessToken.update({ where: { id: req.oauthAccessToken!.id }, data: { revokedAt: new Date() } });
    await expect(list({}, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects an OAuth client that no longer permits the route scope", async () => {
    const req = await oauth();
    await prisma.oAuthClient.update({ where: { id: req.oauthAccessToken!.oauthClientId }, data: { scopes: [] } });
    await expect(list({}, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rolls back disclosure when OAuth is revoked after data loading", async () => {
    const req = await oauth(),
      original = repo().hydrate.bind(repo());
    let changed = false;
    vi.spyOn(repo(), "hydrate").mockImplementation(async (...args) => {
      const data = await original(...args);
      if (!changed) {
        changed = true;
        await prisma.oAuthAccessToken.update({ where: { id: req.oauthAccessToken!.id }, data: { status: 0 } });
      }
      return data;
    });
    await expect(list({}, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks AccessKey revision before returning diagnostic data", async () => {
    const key = await prisma.accessKey.create({
      data: { userId: actor, name: prefix, key: "fixture-key-" + randomUUID() },
    });
    const req = { ...request(), accessKey: { id: key.id } } as TypedRequest;
    expect((await list({}, req)).total).toBe(2);
    const original = repo().hydrate.bind(repo());
    let changed = false;
    vi.spyOn(repo(), "hydrate").mockImplementation(async (...args) => {
      const data = await original(...args);
      if (!changed) {
        changed = true;
        await prisma.accessKey.update({ where: { id: key.id }, data: { status: 0 } });
      }
      return data;
    });
    await expect(list({}, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses metadata-only native preview in shadow and calls the legacy projection exactly once", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const hydrate = vi.spyOn(repo(), "hydrate");
    const usage = (await import("@/store/relay/relay-usage.repository")).RelayUsageRepository.getInstance();
    const read = vi.spyOn(usage, "findRequestDiagnostics");
    expect((await list()).total).toBe(2);
    expect(hydrate).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("legacy mode does not execute the native scanner", async () => {
    env.security.iamAuthorizationMode = "legacy";
    const scan = vi.spyOn(repo(), "scan");
    expect((await list()).total).toBe(2);
    expect(scan).not.toHaveBeenCalled();
  });
});
