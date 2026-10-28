import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { ContentSafetyService } from "@/services/system/content-safety.service";
import { ContentSafetySystemReadRepository } from "@/store/system/content-safety-system-read.repository";
import { ContentSafetyRepository } from "@/store/system/content-safety.repository";
import { ConfigService } from "@/services/system/config.service";
import { PermissionService } from "@/services/users/permission.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import {
  contentSafetySystemConfigArn,
  contentSafetySystemRuleArn,
} from "@/iam/resources/content-safety-system-resources";
import { CONFIG_KEYS } from "@/constant/config-keys";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, groupId: string, a: string, b: string, privateId: string;
const mode = env.security.iamAuthorizationMode,
  service = ContentSafetyService.getInstance(),
  repository = ContentSafetySystemReadRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "safety-read-" + randomUUID(),
        password: "fixture-only-credential",
        accountOwnerId,
        parentUserId: accountOwnerId,
        userType: accountOwnerId ? "ram_user" : "root",
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
async function policy(
  Action: string | string[],
  Resource: string | string[],
  Effect = "Deny",
  principalType = "user",
  principalId = actor,
) {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect, Action, Resource } });
  const created = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "safety-read-policy-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType,
      principalId,
      policyId: created.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
async function roleRequest() {
  const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "Safety read role " + randomUUID() },
    }),
    session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "Safety read",
        tokenJtiHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60000),
      },
    }),
    req = request();
  req.authContext!.assumedRoleId = role.id;
  req.authContext!.roleSessionId = session.id;
  return { role, session, req };
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  groupId = (
    await prisma.group.create({
      data: {
        username: "safety-read-group-" + randomUUID(),
        name: "Safety read",
        level: 5,
        accountOwnerId: null,
        permissions: [Permission.SYSTEM_CONFIG],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  await prisma.contentSafetyRule.deleteMany();
  const rule = async (name: string, priority: number, ownerUserId?: string) =>
    (
      await prisma.contentSafetyRule.create({
        data: {
          name,
          pattern: "pattern-" + name,
          type: "keyword",
          direction: "both",
          action: "allow",
          enabled: true,
          priority,
          ownerUserId,
        },
      })
    ).id;
  a = await rule("public-a", 20);
  b = await rule("public-b", 1);
  privateId = await rule("private-rule", 0, actor);
  await prisma.serverConfig.upsert({
    where: { key: CONFIG_KEYS.CONTENT_SAFETY.AI_API_KEY },
    create: {
      key: CONFIG_KEYS.CONTENT_SAFETY.AI_API_KEY,
      value: "fixture-only-encrypted-marker",
    },
    update: { status: 1, value: "fixture-only-encrypted-marker" },
  });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("system content safety authorized reads", () => {
  it("reads only sanitized current config without using a stale config cache", async () => {
    const cache = vi
      .spyOn(ConfigService.getInstance(), "getMultiple")
      .mockResolvedValue({ [CONFIG_KEYS.CONTENT_SAFETY.AI_API_KEY]: "stale-fixture" });
    const result = await service.readSystemConfig(request());
    expect(result.aiApiKeyConfigured).toBe(true);
    expect(result).not.toHaveProperty("aiApiKey");
    expect(JSON.stringify(result)).not.toContain("fixture-only-encrypted-marker");
    expect(cache).not.toHaveBeenCalled();
  });
  it("does not read raw config values after config Deny", async () => {
    await policy("quyan:content_safety:GetSystemConfig", contentSafetySystemConfigArn());
    const raw = vi.spyOn(repository, "configuration");
    await expect(service.readSystemConfig(request())).rejects.toMatchObject({ statusCode: 403 });
    expect(raw).not.toHaveBeenCalled();
  });
  it("lists only system-owned rules in priority order and excludes private rule bodies", async () => {
    const result = await service.listRules(1, 50, request());
    expect(result.total).toBe(2);
    expect(result.rules.map((row) => row.id)).toEqual([b, a]);
    expect(JSON.stringify(result)).not.toContain("pattern-private-rule");
  });
  it("filters before pagination and exposes only allowed totals", async () => {
    await policy("quyan:content_safety:ListSystemRules", contentSafetySystemRuleArn(b));
    const hydrate = vi.spyOn(repository, "hydrate"),
      result = await service.listRules(1, 1, request());
    expect(result.total).toBe(1);
    expect(result.rules.map((row) => row.id)).toEqual([a]);
    expect(hydrate.mock.calls[0]![0].map((row) => row.id)).toEqual([a]);
    expect((await service.listRules(2, 1, request())).rules).toEqual([]);
  });
  it("can return an empty collection without a matching resource Allow", async () => {
    await policy("quyan:content_safety:ListSystemRules", "*");
    expect(await service.listRules(1, 10, request())).toEqual({ rules: [], total: 0 });
  });
  it("exports only authorized system rules and no private or internal metadata", async () => {
    await policy("quyan:content_safety:ExportSystemRules", contentSafetySystemRuleArn(b));
    const result = await service.exportPolicy(undefined, "json", "system", request()),
      parsed = JSON.parse(result.content);
    expect(parsed.rules.map((row: { id: string }) => row.id)).toEqual([a]);
    expect(result.content).not.toContain("pattern-public-b");
    expect(result.content).not.toContain("pattern-private-rule");
    expect(result.content).not.toContain("fixture-only-encrypted-marker");
    expect(parsed.rules[0]).not.toHaveProperty("revision");
  });
  it("requires config authority for JSON but not CSV", async () => {
    await policy("quyan:content_safety:GetSystemConfig", contentSafetySystemConfigArn());
    await expect(service.exportPolicy(undefined, "json", "system", request())).rejects.toMatchObject({
      statusCode: 403,
    });
    const config = vi.spyOn(repository, "configuration"),
      result = await service.exportPolicy(undefined, "csv", "system", request());
    expect(result.content).toContain("pattern-public-a");
    expect(result.content).not.toContain("fixture-only-encrypted-marker");
    expect(config).not.toHaveBeenCalled();
  });
  it("uses only role resource grants and never inherits the global group's Allow", async () => {
    const { role, session, req } = await roleRequest();
    expect(await service.listRules(1, 50, req)).toEqual({ rules: [], total: 0 });
    await policy(
      ["quyan:content_safety:ListSystemRules", "quyan:content_safety:ExportSystemRules"],
      contentSafetySystemRuleArn(a),
      "Allow",
      "role",
      role.id,
    );
    expect((await service.listRules(1, 50, req)).rules.map((row) => row.id)).toEqual([a]);
    expect((await service.exportPolicy(undefined, "csv", "system", req)).content).toContain("pattern-public-a");
    await expect(service.exportPolicy(undefined, "json", "system", req)).rejects.toMatchObject({ statusCode: 403 });
    await policy("quyan:content_safety:GetSystemConfig", contentSafetySystemConfigArn(), "Allow", "role", role.id);
    expect(JSON.parse((await service.exportPolicy(undefined, "json", "system", req)).content).rules).toHaveLength(1);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.listRules(1, 50, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("cannot manufacture deployment management membership with an account policy", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await policy("quyan:content_safety:ListSystemRules", "*", "Allow");
    await expect(service.listRules(1, 50, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["actor", "owner", "group", "private-group", "context", "oauth"])(
    "fails closed for invalid %s",
    async (kind) => {
      const req = request();
      if (kind === "actor") await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
      if (kind === "owner") await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
      if (kind === "group") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
      if (kind === "private-group")
        await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
      if (kind === "context") req.authContext = undefined;
      if (kind === "oauth") req.oauthAccessToken = {} as never;
      await expect(service.listRules(1, 50, req)).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("uses the same policy path for AccessKey requests", async () => {
    const req = request();
    req.authContext!.subjectType = "access_key";
    expect((await service.listRules(1, 10, req)).total).toBe(2);
  });
  it("detects a raw rule edit even when updateTime remains unchanged", async () => {
    const hydrate = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (targets) => {
      const rows = await hydrate(targets);
      if (rows.length)
        await prisma.contentSafetyRule.update({
          where: { id: rows[0]!.id },
          data: { pattern: "raw-revision-change", updateTime: rows[0]!.updateTime },
        });
      return rows;
    });
    await expect(service.listRules(1, 50, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("detects movement from system to private ownership after hydration", async () => {
    const hydrate = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (targets) => {
      const rows = await hydrate(targets);
      if (rows.length)
        await prisma.contentSafetyRule.update({ where: { id: rows[0]!.id }, data: { ownerUserId: actor } });
      return rows;
    });
    await expect(service.listRules(1, 50, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks source config changes before returning JSON", async () => {
    const read = repository.configuration.bind(repository);
    let reads = 0;
    vi.spyOn(repository, "configuration").mockImplementation(async () => {
      if (++reads === 2)
        await prisma.serverConfig.update({
          where: { key: CONFIG_KEYS.CONTENT_SAFETY.AI_API_KEY },
          data: { value: "changed-encrypted-fixture" },
        });
      return read();
    });
    await expect(service.exportPolicy(undefined, "json", "system", request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("rechecks grants changed after rule hydration", async () => {
    const hydrate = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (targets) => {
      const rows = await hydrate(targets);
      await policy("quyan:content_safety:ListSystemRules", "*");
      return rows;
    });
    await expect(service.listRules(1, 50, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not let direct enforced system readers omit the request", async () => {
    await expect(service.listRules()).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.exportPolicy(undefined, "json", "system")).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("preserves legacy pagination clamping in %s", async (next) => {
    env.security.iamAuthorizationMode = next;
    const result = await service.listRules(0, 500, request());
    expect(result.total).toBe(3);
    expect(result.rules).toHaveLength(3);
  });
  it.each(["legacy", "shadow"] as const)("retains old read enforcement in %s", async (next) => {
    env.security.iamAuthorizationMode = next;
    await policy("quyan:content_safety:ListSystemRules", "*");
    const raw = vi.spyOn(ContentSafetyRepository.getInstance(), "listAllRules"),
      result = await service.listRules(1, 50, request());
    expect(result.rules.some((row) => row.id === privateId)).toBe(true);
    expect(raw).toHaveBeenCalledOnce();
    vi.spyOn(PermissionService.getInstance(), "checkUserPermissions").mockResolvedValue({
      hasPermission: false,
      checkedPermissions: [Permission.SYSTEM_CONFIG],
      missingPermissions: [Permission.SYSTEM_CONFIG],
    });
    await expect(service.listRules(1, 50, request())).rejects.toMatchObject({ statusCode: 403 });
  });
});
