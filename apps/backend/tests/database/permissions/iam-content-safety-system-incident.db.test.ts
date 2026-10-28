import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { ContentSafetyService } from "@/services/system/content-safety.service";
import { ContentSafetyRepository } from "@/store/system/content-safety.repository";
import { ContentSafetySystemIncidentRepository } from "@/store/system/content-safety-system-incident.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import {
  contentSafetySystemIncidentArn,
  contentSafetySystemRuleArn,
} from "@/iam/resources/content-safety-system-resources";
import type { ContentSafetyIncidentQuery } from "@/api/dto/system/content-safety.dto";
import type { TypedRequest } from "@/types/express";
let owner: string,
  actor: string,
  groupId: string,
  rule: string,
  privateRule: string,
  token: string,
  channel: string,
  a: string,
  b: string,
  c: string;
const mode = env.security.iamAuthorizationMode,
  service = ContentSafetyService.getInstance(),
  repository = ContentSafetySystemIncidentRepository.getInstance(),
  legacy = ContentSafetyRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "incident-read-" + randomUUID(),
        password: "fixture-only-credential",
        userType: accountOwnerId ? "ram_user" : "root",
        accountOwnerId,
        parentUserId: accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "*", "x-account-id": "forged" },
    secure: true,
    ip: "192.0.2.20",
  }) as unknown as TypedRequest;
async function policy(document: unknown, principalType = "user", principalId = actor) {
  const parsed = parseIamPolicy(document),
    row = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "Incident policy " + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType,
      principalId,
      policyId: row.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  groupId = (
    await prisma.group.create({
      data: {
        username: "incident-read-group-" + randomUUID(),
        name: "Incident read fixture",
        level: 5,
        accountOwnerId: null,
        permissions: [Permission.SYSTEM_CONFIG],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  await prisma.contentSafetyIncident.deleteMany();
  rule = (
    await prisma.contentSafetyRule.create({
      data: { name: "System rule", type: "literal", pattern: "system-pattern", direction: "both", action: "allow" },
    })
  ).id;
  privateRule = (
    await prisma.contentSafetyRule.create({
      data: {
        name: "Private rule",
        type: "literal",
        pattern: "private-pattern",
        direction: "both",
        action: "allow",
        ownerUserId: actor,
      },
    })
  ).id;
  channel = (
    await prisma.relayChannel.create({
      data: { name: "Incident channel", openaiUpstreamApiKey: "fixture-only-channel-secret" },
    })
  ).id;
  token = (
    await prisma.relayToken.create({
      data: {
        userId: actor,
        name: "Incident token",
        token: "fixture-only-token-" + randomUUID(),
        upstreamApiKey: "fixture-only-token-secret",
        channelId: channel,
      },
    })
  ).id;
  const create = async (index: number, input: any) =>
    (
      await prisma.contentSafetyIncident.create({
        data: {
          userId: actor,
          direction: "request",
          action: "allow",
          source: "rule",
          ruleId: rule,
          relayTokenId: token,
          channelId: channel,
          matchText: "matched",
          matchContext: "authorized-context-" + index,
          auditCost: "1.25",
          createTime: new Date("2026-01-01T00:00:0" + index + "Z"),
          ...input,
        },
      })
    ).id;
  a = await create(1, { requestId: "zeta", action: "allow", statusCode: 200 });
  b = await create(2, {
    requestId: "Alpha",
    action: "unreachable",
    direction: "response",
    source: "ai",
    blocked: true,
    statusCode: 403,
  });
  c = await create(3, { requestId: null, action: "blackhole", replaced: true, statusCode: null, ruleId: privateRule });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("system content safety incident resource reads", () => {
  it("filters resources before pagination and total count without reading denied bodies", async () => {
    await policy({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:content_safety:ListSystemIncidents",
        Resource: contentSafetySystemIncidentArn(b),
      },
    });
    const hydrate = vi.spyOn(repository, "hydrate");
    const result = await service.listSystemIncidents({ page: 1, pageSize: 1 }, request());
    expect(result.total).toBe(2);
    expect(result.incidents.map((row) => row.id)).toEqual([c]);
    expect(result.incidents[0]!.auditCost).toBe("1.25");
    expect(result.incidents[0]!.createTime).toBe("2026-01-01T00:00:03.000Z");
    expect(hydrate.mock.calls[0]![1].map((row) => row.id)).toEqual([c]);
    expect(JSON.stringify(result)).not.toContain("authorized-context-2");
    expect(
      (await service.listSystemIncidents({ page: 2, pageSize: 1 }, request())).incidents.map((row) => row.id),
    ).toEqual([a]);
  });
  it("shows context names while keeping upstream and token credentials out of responses", async () => {
    const result = await service.listSystemIncidents({}, request());
    expect(result.incidents[0]).toMatchObject({ relayTokenName: "Incident token", channelName: "Incident channel" });
    expect(JSON.stringify(result)).not.toContain("fixture-only-token");
    expect(JSON.stringify(result)).not.toContain("fixture-only-channel-secret");
  });
  it("omits denied or private associated rule patterns", async () => {
    await policy({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:content_safety:ListSystemRules",
        Resource: contentSafetySystemRuleArn(rule),
      },
    });
    const result = await service.listSystemIncidents({}, request());
    expect(result.total).toBe(3);
    expect(result.incidents.every((row) => !row.rule?.pattern)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("system-pattern");
    expect(JSON.stringify(result)).not.toContain("private-pattern");
  });
  it("includes a separately authorized active system rule pattern", async () => {
    const result = await service.listSystemIncidents({ requestId: "zeta" }, request());
    expect(result.incidents[0]!.rule).toEqual({ name: "System rule", type: "literal", pattern: "system-pattern" });
  });
  it.each(["createTime", "requestId", "action", "source", "statusCode"] as const)(
    "preserves database sorting for %s with both directions",
    async (sortBy) => {
      for (const sortOrder of ["asc", "desc"] as const) {
        const expected = await legacy.listIncidents({ sortBy, sortOrder });
        const actual = await service.listSystemIncidents({ sortBy, sortOrder }, request());
        expect(actual.incidents.map((row) => row.id)).toEqual(expected.incidents.map((row) => row.id));
      }
    },
  );
  it.each([
    { userId: "actor" },
    { direction: "response" },
    { source: "ai" },
    { processingStatus: "blocked" },
    { processingStatus: "replaced" },
    { requestId: "alpha" },
    { relayTokenName: "Incident token" },
    { channelName: "Incident channel" },
    { startTime: "2026-01-01T00:00:02Z", endTime: "2026-01-01T00:00:03Z" },
  ] as ContentSafetyIncidentQuery[])("preserves existing filters %j", async (query) => {
    if (query.userId) query = { ...query, userId: actor };
    const expected = await legacy.listIncidents(query),
      actual = await service.listSystemIncidents(query, request());
    expect(actual.total).toBe(expected.total);
    expect(actual.incidents.map((row) => row.id)).toEqual(expected.incidents.map((row) => row.id));
  });
  it.each(["incident", "rule", "token", "channel", "authorization", "group"])(
    "rejects %s changes before hydration",
    async (kind) => {
      const hydrate = repository.hydrate.bind(repository);
      vi.spyOn(repository, "hydrate").mockImplementation(async (where, targets, ruleIds) => {
        if (kind === "incident")
          await prisma.$executeRaw`UPDATE content_safety_incidents SET matchContext='changed-body' WHERE id=${a}`;
        if (kind === "rule")
          await prisma.$executeRaw`UPDATE content_safety_rules SET pattern='changed-pattern' WHERE id=${rule}`;
        if (kind === "token") await prisma.$executeRaw`UPDATE relay_tokens SET name='changed-name' WHERE id=${token}`;
        if (kind === "channel")
          await prisma.$executeRaw`UPDATE relay_channels SET name='changed-name' WHERE id=${channel}`;
        if (kind === "authorization")
          await policy({
            Version: "1",
            Statement: {
              Effect: "Deny",
              Action: "quyan:content_safety:ListSystemIncidents",
              Resource: contentSafetySystemIncidentArn(a),
            },
          });
        if (kind === "group") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
        return hydrate(where, targets, ruleIds);
      });
      await expect(service.listSystemIncidents({}, request())).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it.each(["missing-allow", "allow", "deny"])("requires independent role incident authority for %s", async (kind) => {
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "Incident role " + randomUUID() },
    });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "Incident read",
        tokenJtiHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const req = request();
    req.authContext!.assumedRoleId = role.id;
    req.authContext!.roleSessionId = session.id;
    if (kind !== "missing-allow")
      await policy(
        {
          Version: "1",
          Statement: [
            {
              Effect: "Allow",
              Action: "quyan:content_safety:ListSystemIncidents",
              Resource: contentSafetySystemIncidentArn(a),
            },
            ...(kind === "deny"
              ? [
                  {
                    Effect: "Deny",
                    Action: "quyan:content_safety:ListSystemIncidents",
                    Resource: contentSafetySystemIncidentArn(a),
                  },
                ]
              : []),
          ],
        },
        "role",
        role.id,
      );
    const result = await service.listSystemIncidents({}, req);
    expect(result.total).toBe(kind === "allow" ? 1 : 0);
    if (kind === "allow") {
      expect(result.incidents.map((row) => row.id)).toEqual([a]);
      expect(result.incidents[0]!.rule?.pattern).toBeUndefined();
    }
  });
  it.each(["disabled-actor", "disabled-owner", "private-group", "oauth", "no-context"])(
    "fails closed for %s",
    async (kind) => {
      if (kind === "disabled-actor") await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
      if (kind === "disabled-owner") await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
      if (kind === "private-group")
        await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
      const req = request();
      if (kind === "oauth") req.oauthAccessToken = {} as any;
      await expect(service.listSystemIncidents({}, kind === "no-context" ? undefined : req)).rejects.toMatchObject({
        statusCode: 403,
      });
    },
  );
  it.each([
    { page: 0 },
    { pageSize: 101 },
    { sortBy: "unsafe-column" },
    { sortOrder: "unsafe-order" },
    { startTime: "not-a-date" },
    { startTime: "2026-01-02", endTime: "2026-01-01" },
  ] as ContentSafetyIncidentQuery[])("rejects malformed query %j", async (query) => {
    await expect(service.listSystemIncidents(query, request())).rejects.toMatchObject({ statusCode: 400 });
  });
  it.each(["legacy", "shadow"] as const)("retains old system incident behavior in %s", async (next) => {
    env.security.iamAuthorizationMode = next;
    const read = vi.spyOn(legacy, "listIncidents");
    const result = await service.listSystemIncidents({}, request());
    expect(result.total).toBe(3);
    expect(read).toHaveBeenCalledOnce();
    expect(result.incidents.find((row) => row.id === c)!.rule?.pattern).toBe("private-pattern");
  });
});
