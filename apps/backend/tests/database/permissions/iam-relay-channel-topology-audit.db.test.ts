import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { Permission, RELAY_CHANNEL_STATUS } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import { RelayConfigService } from "@/services/relay/relay-config.service";
import {
  RelayChannelTopologyAuditRepository,
  relayChannelTopologySelect,
} from "@/store/relay/relay-channel-topology-audit.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { platformRelayConfigurationArn } from "@/iam/resources/platform-relay-configuration-resources";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:AuditChannelTopology",
  mode = env.security.iamAuthorizationMode;
let owner: string, actor: string, groupId: string, root: string, leaf: string, config: string, prefix: string;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
    secure: true,
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
const audit = (req = request()) => RelayChannelService.getInstance().getTopologyAudit(actor, req);
async function grant(resources: string[], Effect: "Allow" | "Deny" = "Deny", principal = { type: "user", id: actor }) {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect, Action: action, Resource: resources } });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: prefix + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: principal.type,
      principalId: principal.id,
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
  prefix = "topology-iam-" + randomUUID();
  await prisma.relayChannel.deleteMany();
  await prisma.relayConfig.deleteMany();
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: prefix + randomUUID(),
          password: "fixture-only",
          userType: accountOwnerId ? "ram_user" : "root",
          accountOwnerId,
          parentUserId: accountOwnerId,
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;
  owner = await user();
  actor = await user(owner);
  groupId = (
    await prisma.group.create({
      data: { name: prefix, username: prefix, accountOwnerId: null, permissions: [Permission.RELAY_CHANNEL_READ] },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  config = (await prisma.relayConfig.create({ data: { channelTopologyMode: "legacy" } })).id;
  root = (
    await prisma.relayChannel.create({
      data: { name: prefix + "root", channelType: "pooled", openaiUpstreamApiKey: "fixture-secret" },
    })
  ).id;
  leaf = (
    await prisma.relayChannel.create({
      data: { name: prefix + "leaf", channelType: "pooled-member", pooledParentId: root },
    })
  ).id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  await prisma.ramRoleSession.deleteMany({ where: { accountOwnerId: owner } });
});
describe("full-admission topology audit", () => {
  it("audits the full topology and mode without rich channel/config/report reads", async () => {
    const rich = vi.spyOn(RelayChannelRepository.getInstance(), "listVisible"),
      reports = vi.spyOn(RelayConfigService.getInstance(), "getRelayConfig");
    expect(await audit()).toEqual({ mode: "legacy", canEnableStrict: true, issues: [] });
    expect(rich).not.toHaveBeenCalled();
    expect(reports).not.toHaveBeenCalled();
    await prisma.relayConfig.update({ where: { id: config }, data: { channelTopologyMode: "strict-two-tier" } });
    expect(await audit()).toMatchObject({ mode: "strict-two-tier" });
  });
  it.each(["configuration", "root", "leaf"])(
    "rejects the whole audit rather than claiming a partial graph is safe when %s is denied",
    async (kind) => {
      await grant([
        kind === "configuration"
          ? platformRelayConfigurationArn()
          : platformRelayChannelArn(kind === "root" ? root : leaf),
      ]);
      await expect(audit()).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("requires the audit Action even when a qualified reader has no policies", async () => {
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockResolvedValue([]);
    await expect(audit()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("supports exact JSON grants with the persisted reviewer ceiling", async () => {
    const iam = IamAuthorizationService.getInstance(),
      original = iam.loadPolicies.bind(iam);
    await grant(
      [platformRelayConfigurationArn(), platformRelayChannelArn(root), platformRelayChannelArn(leaf)],
      "Allow",
    );
    vi.spyOn(iam, "loadPolicies").mockImplementation(async (p) =>
      (await original(p)).filter((row) => !row.policyId.startsWith("legacy:")),
    );
    expect(await audit()).toMatchObject({ canEnableStrict: true });
  });
  it.each(["account", "none", "disabled"])(
    "does not manufacture a deployment ceiling from policies: %s",
    async (kind) => {
      await grant(["*"], "Allow");
      if (kind === "account") await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
      if (kind === "none")
        await prisma.user.update({
          where: { id: actor },
          data: { groupId: null, permissionAdds: [Permission.RELAY_CHANNEL_READ] },
        });
      if (kind === "disabled") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
      await expect(audit()).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("reports every invariant shared by strict-mode admission, including a nonmember parent", async () => {
    await prisma.relayChannelMember.create({ data: { relayChannelId: root, memberChannelId: leaf, priority: 0 } });
    await prisma.relayChannel.update({ where: { id: leaf }, data: { pooledParentId: null } });
    const automatic = await prisma.relayChannel.create({
      data: { name: prefix + "auto", channelType: "automatic-proxy-pool" },
    });
    await prisma.relayChannelMember.create({
      data: { relayChannelId: automatic.id, memberChannelId: leaf, priority: 0 },
    });
    await prisma.relayChannel.create({
      data: { name: prefix + "wrong", channelType: "standalone", pooledParentId: root },
    });
    const result = await audit();
    expect(result.canEnableStrict).toBe(false);
    expect(result.issues.map((row) => row.code).sort()).toEqual([
      "automatic_pool_physical_member",
      "invalid_pooled_parent",
      "legacy_pool_members",
      "non_member_pooled_parent",
    ]);
  });
  it("does not hide a disabled broken channel from a global readiness report", async () => {
    await prisma.relayChannel.update({
      where: { id: leaf },
      data: { pooledParentId: null, status: RELAY_CHANNEL_STATUS.DISABLED },
    });
    expect(await audit()).toMatchObject({
      canEnableStrict: false,
      issues: [{ channelId: leaf, code: "invalid_pooled_parent" }],
    });
    await prisma.relayChannel.update({ where: { id: leaf }, data: { status: RELAY_CHANNEL_STATUS.DELETED } });
    expect(await audit()).toMatchObject({ canEnableStrict: true });
  });
  it("preserves business visibility and never turns a restricted graph into global success", async () => {
    await prisma.relayChannel.update({ where: { id: leaf }, data: { visibilityMode: "private" } });
    await expect(audit()).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({
      where: { id: groupId },
      data: { permissions: [Permission.RELAY_CHANNEL_READ, Permission.RELAY_CHANNEL_REVIEW] },
    });
    expect(await audit()).toMatchObject({ canEnableStrict: true });
  });
  it("does not accept an IAM management grant as a business visibility bypass", async () => {
    await prisma.relayChannel.update({ where: { id: leaf }, data: { visibilityMode: "private" } });
    const parsed = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:relay:channel:Review", Resource: "*" },
    });
    const policy = await RamPolicyRepository.getInstance().createPolicy({
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
        policyId: policy.id,
        scopeType: "account",
        scopeKey: "account",
        createdBy: owner,
      },
    });
    await expect(audit()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("returns safe success for an empty fully-authorized graph without creating config defaults", async () => {
    await prisma.relayChannel.deleteMany();
    await prisma.relayConfig.deleteMany();
    expect(await audit()).toEqual({ mode: "legacy", canEnableStrict: true, issues: [] });
    expect(await prisma.relayConfig.count()).toBe(0);
  });
  it("selects only audit metadata and topology, never credentials, prices or unrelated config", async () => {
    const original = prisma.$transaction.bind(prisma),
      reads: Prisma.RelayChannelFindManyArgs[] = [];
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: object,
    ) =>
      original(async (tx) => {
        const find = tx.relayChannel.findMany.bind(tx.relayChannel);
        vi.spyOn(tx.relayChannel, "findMany").mockImplementation((args) => {
          if (args) reads.push(args);
          return find(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    const result = await audit();
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.include).toBeUndefined();
      expect(read.select).toBeDefined();
      for (const field of [
        "openaiUpstreamApiKey",
        "anthropicUpstreamApiKey",
        "geminiUpstreamApiKey",
        "openaiUpstreamUrl",
        "providers",
        "modelMapping",
      ])
        expect(read.select).not.toHaveProperty(field);
    }
    expect(relayChannelTopologySelect).not.toHaveProperty("openaiUpstreamApiKey");
  });
  it("does not hydrate denied topology or visibility details", async () => {
    await grant([platformRelayChannelArn(leaf)]);
    const original = prisma.$transaction.bind(prisma),
      reads: Prisma.RelayChannelFindManyArgs[] = [];
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: object,
    ) =>
      original(async (tx) => {
        const find = tx.relayChannel.findMany.bind(tx.relayChannel);
        vi.spyOn(tx.relayChannel, "findMany").mockImplementation((args) => {
          if (args) reads.push(args);
          return find(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    await expect(audit()).rejects.toMatchObject({ statusCode: 403 });
    expect(reads.some((row) => row.select?.name || row.select?.visibilityConfig)).toBe(false);
  });
  it("rechecks contributing Allow decisions before returning", async () => {
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    let count = 0;
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const result = await original(input);
      return ++count > 2 ? result.map((row) => ({ ...row, decision: "ExplicitDeny" as const })) : result;
    });
    await expect(audit()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["principal", "policy", "group", "key", "config", "relation", "visibility"] as const)(
    "rejects late %s changes without a report",
    async (kind) => {
      const repository = RelayChannelTopologyAuditRepository.getInstance(),
        original = repository.audit.bind(repository),
        req = request();
      if (kind === "key") {
        const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-key-" + randomUUID() } });
        req.accessKey = { id: key.id } as NonNullable<TypedRequest["accessKey"]>;
        req.authContext!.subjectType = "access_key";
      }
      if (["config", "relation", "visibility"].includes(kind)) {
        const transaction = prisma.$transaction.bind(prisma);
        vi.spyOn(prisma, "$transaction").mockImplementation(((
          callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options?: object,
        ) =>
          transaction(async (tx) => {
            const find = tx.relayChannel.findMany.bind(tx.relayChannel);
            let changed = false;
            vi.spyOn(tx.relayChannel, "findMany").mockImplementation((async (
              args?: Prisma.RelayChannelFindManyArgs,
            ) => {
              const result = await find(args);
              if (args?.select?.name && !changed) {
                changed = true;
                if (kind === "config")
                  await tx.$executeRaw`UPDATE relay_configs SET channelTopologyMode = ${"strict-two-tier"} WHERE id = ${config}`;
                if (kind === "relation")
                  await tx.relayChannelMember.create({
                    data: { relayChannelId: root, memberChannelId: leaf, priority: 0 },
                  });
                if (kind === "visibility")
                  await tx.$executeRaw`UPDATE relay_channels SET visibilityMode = ${"private"} WHERE id = ${leaf}`;
              }
              return result;
            }) as typeof tx.relayChannel.findMany);
            return callback(tx);
          }, options)) as typeof prisma.$transaction);
      } else
        vi.spyOn(repository, "audit").mockImplementation(async (...args) => {
          const result = await original(...args);
          if (kind === "principal") req.authContext!.principalUserId = owner;
          if (kind === "policy") await grant([platformRelayChannelArn(leaf)]);
          if (kind === "group") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
          if (kind === "key") await prisma.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
          return result;
        });
      await expect(audit(req)).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("does not merge user privileges into role sessions and rejects revoked sessions", async () => {
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
    await expect(audit(req)).rejects.toMatchObject({ statusCode: 403 });
    await grant(["*"], "Allow", { type: "role", id: role.id });
    expect(await audit(req)).toMatchObject({ canEnableStrict: true });
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(audit(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)(
    "keeps the legacy report exactly once in %s without native topology hydration",
    async (selected) => {
      env.security.iamAuthorizationMode = selected;
      const rich = vi.spyOn(RelayChannelRepository.getInstance(), "listVisible"),
        repository = RelayChannelTopologyAuditRepository.getInstance(),
        original = repository.audit.bind(repository);
      const native = vi.spyOn(repository, "audit").mockImplementation(async (...args) => {
        expect(args[3]).toBe(false);
        const result = await original(...args);
        expect(result).toBeUndefined();
        return result;
      });
      expect(await audit()).toMatchObject({ canEnableStrict: true });
      expect(rich).toHaveBeenCalledTimes(1);
      expect(native).toHaveBeenCalledTimes(selected === "shadow" ? 1 : 0);
    },
  );
  it("audits past the decision batch boundary and rejects a denied last resource", async () => {
    const count = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest + 1;
    const generated = Array.from({ length: count }, (_, i) => ({
      id: "zz-topology-" + String(i).padStart(5, "0"),
      name: prefix + "-" + i,
    }));
    await prisma.relayChannel.createMany({ data: generated });
    const iam = IamAuthorizationService.getInstance(),
      decisions = vi.spyOn(iam, "authorizeMany");
    expect(await audit()).toMatchObject({ canEnableStrict: true });
    expect(
      decisions.mock.calls.every(([input]) => input.resources.length <= IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
    ).toBe(true);
    await grant([platformRelayChannelArn(generated[generated.length - 1]!.id)]);
    await expect(audit()).rejects.toMatchObject({ statusCode: 403 });
  }, 20000);
  it("preserves OAuth READ admission and rechecks live scopes before returning", async () => {
    const client = await prisma.oAuthClient.create({
      data: {
        userId: actor,
        clientId: prefix + randomUUID(),
        name: prefix,
        clientSecretHash: "fixture-hash",
        grantTypes: ["authorization_code"],
        redirectUris: [],
        scopes: [Permission.RELAY_CHANNEL_READ],
        reviewStatus: "approved",
      },
    });
    const token = await prisma.oAuthAccessToken.create({
      data: {
        userId: actor,
        oauthClientId: client.id,
        tokenHash: randomUUID(),
        scopes: [Permission.RELAY_CHANNEL_READ],
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const req = request();
    req.oauthAccessToken = {
      id: token.id,
      oauthClientId: client.id,
      userId: actor,
      scopes: [Permission.RELAY_CHANNEL_READ],
    } as NonNullable<TypedRequest["oauthAccessToken"]>;
    expect(await audit(req)).toMatchObject({ canEnableStrict: true });
    const repository = RelayChannelTopologyAuditRepository.getInstance(),
      original = repository.audit.bind(repository);
    vi.spyOn(repository, "audit").mockImplementation(async (...args) => {
      const result = await original(...args);
      await prisma.oAuthClient.update({ where: { id: client.id }, data: { scopes: [] } });
      return result;
    });
    await expect(audit(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects absent context and unknown rollout modes", async () => {
    await expect(RelayChannelService.getInstance().getTopologyAudit(actor)).rejects.toMatchObject({ statusCode: 403 });
    env.security.iamAuthorizationMode = "invalid" as typeof env.security.iamAuthorizationMode;
    await expect(audit()).rejects.toMatchObject({ statusCode: 403 });
  });
});
