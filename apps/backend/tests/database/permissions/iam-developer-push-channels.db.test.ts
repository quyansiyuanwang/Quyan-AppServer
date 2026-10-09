import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { DeveloperProjectManagementService } from "@/services/developer/developer-project-management.service";
import { DeveloperProjectController } from "@/api/controllers/v1/developer/developer-project.controller";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import axios from "axios";
import * as outbound from "@/util/developer-outbound-url";
import { developerPushChannelArn } from "@/iam/resources/developer-resources";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { DeveloperProjectRepository } from "@/store/developer/developer-project.repository";
import { DeveloperPushChannelRepository } from "@/store/developer/developer-push-channel.repository";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";

const service = DeveloperProjectManagementService.getInstance();
const controller = new DeveloperProjectController();
const ram = RamService.getInstance();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, peer: string, foreign: string;
const projectArn = (id: string) => "acs:developer:*:" + owner + ":project/" + id;
const arn = (projectId: string, id: string) => developerPushChannelArn(owner, projectId, id);
const run = <T>(operation: (request: TypedRequest) => Promise<T>, auth = {}) =>
  new AsyncResource("push-channel-iam-fixture").runInAsyncScope(async () => {
    const request = {
      user: { userId: actor },
      params: {},
      body: {},
      headers: { "x-action": "quyan:developer:GetProject", "x-account-id": foreign },
      ip: "127.0.0.1",
      secure: true,
      authContext: { principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user", ...auth },
    } as unknown as TypedRequest;
    setRequestContext(request);
    return operation(request);
  });
const project = (userId = actor, createTime = new Date()) =>
  prisma.developerProject.create({
    data: {
      userId,
      name: "Project fixture " + randomUUID(),
      slug: "push-channel-iam-" + randomUUID(),
      createTime,
    },
  });
async function grant(
  Action: string | string[],
  Resource: string,
  Effect: "Allow" | "Deny" = "Allow",
  targetType: "user" | "role" = "user",
  targetId = actor,
) {
  const policy = await ram.createPolicy(owner, {
    name: "push-channel-iam-" + randomUUID(),
    document: {
      Version: "1",
      Statement: { Effect, Action, Resource },
    },
  });
  await ram.createAuthorization(owner, {
    principalType: targetType,
    principalId: targetId,
    policyId: policy.id,
    scopeType: "account",
  });
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "push-channel-iam-user-" + randomUUID(),
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
  peer = await user(owner);
  foreign = await user();
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
  vi.restoreAllMocks();
});

/** Synthetic metadata fixtures; invalid ciphertext deliberately proves channel management never decrypts credentials. */
const endpoint = "https://1.1.1.1/iam-push-fixture";
const body = (name = "Channel fixture " + randomUUID()) => ({ name, type: "webhook" as const, endpoint });
const channel = (projectId: string, createTime = new Date()) =>
  prisma.developerPushChannel.create({ data: { projectId, createTime, ...body() } });
async function vault(userId = peer) {
  const backing = await project(userId);
  const entitlement = await prisma.developerProductEntitlement.upsert({
    where: { accountOwnerId_productCode: { accountOwnerId: userId, productCode: "secret" } },
    update: {},
    create: { accountOwnerId: userId, productCode: "secret", issuedByUserId: owner },
  });
  const instance = await prisma.developerProductInstance.create({
    data: {
      entitlementId: entitlement.id,
      backingProjectId: backing.id,
      name: "Vault fixture",
      slug: "vault-fixture-" + randomUUID(),
    },
  });
  const secret = await prisma.developerSecret.create({
    data: {
      projectId: backing.id,
      alias: "TOKEN",
      ciphertext: "fixture-only-invalid-ciphertext",
      iv: "fixture-only",
      authTag: "fixture-only",
    },
  });
  return {
    backing,
    entitlement,
    instance,
    secret,
    reference: { secretInstanceId: instance.id, alias: secret.alias },
    resource: "acs:developer:*:" + owner + ":secret/" + backing.id + "/" + secret.alias,
  };
}
async function bind(channelId: string, target: Awaited<ReturnType<typeof vault>>) {
  return prisma.developerPushChannel.update({
    where: { id: channelId },
    data: {
      secretAlias: target.secret.alias,
      config: { secretInstanceId: target.instance.id, secretProjectId: target.backing.id, fixtureMetadata: true },
    },
  });
}
describe("IAM Push Channel management", () => {
  it("delegates one peer channel without transferring project ownership or sending messages", async () => {
    const target = await project(peer),
      row = await channel(target.id),
      hidden = await channel(target.id);
    await grant(
      ["quyan:developer:ListPushChannels", "quyan:developer:UpdatePushChannel", "quyan:developer:DeletePushChannel"],
      arn(target.id, row.id),
    );
    const post = vi.spyOn(axios, "post");
    expect((await run((request) => controller.listPushChannels(target.id, request))).map((item) => item.id)).toEqual([
      row.id,
    ]);
    expect(
      await run((request) =>
        controller.updatePushChannel(target.id, row.id, { name: "Delegated fixture", enabled: false }, request),
      ),
    ).toMatchObject({ id: row.id, name: "Delegated fixture", enabled: false, resourceArn: arn(target.id, row.id) });
    await expect(
      run(() => service.updatePushChannel(target.id, hidden.id, actor, { enabled: false })),
    ).rejects.toMatchObject({ statusCode: 403 });
    await run((request) => controller.deletePushChannel(target.id, row.id, request));
    expect(await prisma.developerPushChannel.findUnique({ where: { id: row.id } })).toBeNull();
    expect((await prisma.developerProject.findUniqueOrThrow({ where: { id: target.id } })).userId).toBe(peer);
    expect(post).not.toHaveBeenCalled();
  });
  it("authorizes creation on its project without manufacturing child grants", async () => {
    const target = await project(peer),
      other = await project(peer);
    await expect(run(() => service.createPushChannel(target.id, actor, body()))).rejects.toMatchObject({
      statusCode: 403,
    });
    await grant("quyan:developer:CreatePushChannel", projectArn(target.id));
    const row = await run((request) => controller.createPushChannel(target.id, body(), request));
    expect(row.resourceArn).toBe(arn(target.id, row.id));
    expect(await run(() => service.listPushChannels(target.id, actor))).toEqual([]);
    await expect(run(() => service.createPushChannel(other.id, actor, body()))).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(run(() => service.deletePushChannel(target.id, row.id, actor))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("blocks matching Deny and ignores forged Action headers", async () => {
    const target = await project(peer),
      row = await channel(target.id);
    await grant("quyan:developer:UpdatePushChannel", arn(target.id, row.id));
    await grant("quyan:developer:UpdatePushChannel", arn(target.id, row.id), "Deny");
    await run(async (request) => {
      request.headers["x-action"] = "quyan:developer:ListPushChannels";
      await expect(
        controller.updatePushChannel(target.id, row.id, { name: "must-not-write" }, request),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(request.iamDecisions?.at(-1)).toMatchObject({
        action: "quyan:developer:UpdatePushChannel",
        decision: "ExplicitDeny",
      });
      expect(JSON.stringify(request.iamDecisions)).not.toContain(endpoint);
    });
  });
  it("paginates active candidates before row checks without exposing config or an unauthorized total", async () => {
    const target = await project(peer),
      visible = await channel(target.id, new Date("2026-01-01T00:00:00Z"));
    await channel(target.id, new Date("2026-02-01T00:00:00Z"));
    const inactive = await channel(target.id, new Date("2026-03-01T00:00:00Z"));
    await prisma.developerPushChannel.update({ where: { id: inactive.id }, data: { status: 0 } });
    await grant("quyan:developer:ListPushChannels", arn(target.id, visible.id));
    expect(await run((request) => controller.listPushChannelsPage(target.id, request, 1, 1))).toEqual({
      items: [],
      page: 1,
      pageSize: 1,
      hasNext: true,
    });
    const page = await run((request) => controller.listPushChannelsPage(target.id, request, 2, 1));
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: visible.id, resourceArn: arn(target.id, visible.id) });
    expect(page.hasNext).toBe(false);
    expect(page).not.toHaveProperty("total");
    expect(page.items[0]).not.toHaveProperty("config");
  });
  it("does not widen project listing to channel resources", async () => {
    const target = await project(peer);
    await channel(target.id);
    await grant("quyan:developer:ListPushChannels", projectArn(target.id));
    expect((await run(() => service.listPushChannelsPage(target.id, actor))).items).toEqual([]);
  });
  it("requires a separate exact UseSecret grant for binding and never decrypts during management", async () => {
    const target = await project(peer),
      secret = await vault();
    const decrypt = vi.spyOn(DeveloperProjectRepository.getInstance(), "resolveSecret");
    await grant("quyan:developer:CreatePushChannel", projectArn(target.id));
    await expect(
      run(() => service.createPushChannel(target.id, actor, { ...body(), secretReference: secret.reference })),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerPushChannel.count({ where: { projectId: target.id } })).toBe(0);
    await grant("quyan:developer:UseSecret", secret.resource);
    const created = await run(() =>
      service.createPushChannel(target.id, actor, { ...body(), secretReference: secret.reference }),
    );
    expect(created.secretReference).toEqual(secret.reference);
    expect(JSON.stringify(created)).not.toContain(secret.secret.ciphertext);
    expect(created).not.toHaveProperty("config");
    expect(decrypt).not.toHaveBeenCalled();
    expect((await prisma.developerSecret.findUniqueOrThrow({ where: { id: secret.secret.id } })).lastUsedAt).toBeNull();
    await expect(run(() => service.deletePushChannel(target.id, created.id, actor))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("requires UseSecret for redirecting or re-enabling an existing binding but not for safe metadata changes", async () => {
    const target = await project(peer),
      row = await channel(target.id),
      secret = await vault();
    await bind(row.id, secret);
    await grant("quyan:developer:UpdatePushChannel", arn(target.id, row.id));
    expect(
      (await run(() => service.updatePushChannel(target.id, row.id, actor, { name: "Safe metadata", enabled: false })))
        .enabled,
    ).toBe(false);
    for (const change of [{ endpoint: endpoint + "-other" }, { enabled: true }])
      await expect(run(() => service.updatePushChannel(target.id, row.id, actor, change))).rejects.toMatchObject({
        statusCode: 403,
      });
    await grant("quyan:developer:UseSecret", secret.resource);
    expect(
      (
        await run(() =>
          service.updatePushChannel(target.id, row.id, actor, { endpoint: endpoint + "-other", enabled: true }),
        )
      ).endpoint,
    ).toBe(endpoint + "-other");
    await grant("quyan:developer:UseSecret", secret.resource, "Deny");
    await expect(run(() => service.updatePushChannel(target.id, row.id, actor, { endpoint }))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("can atomically remove a binding while changing destination without retaining credential authority", async () => {
    const target = await project(peer),
      row = await channel(target.id),
      secret = await vault();
    await bind(row.id, secret);
    await grant("quyan:developer:UpdatePushChannel", arn(target.id, row.id));
    const updated = await run(() =>
      service.updatePushChannel(target.id, row.id, actor, {
        secretReference: null,
        endpoint: endpoint + "-safe",
        enabled: true,
      }),
    );
    expect(updated.secretReference).toBeUndefined();
    expect(updated.secretAlias).toBeUndefined();
    const stored = await prisma.developerPushChannel.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.secretAlias).toBeNull();
    expect(stored.config).toEqual({ fixtureMetadata: true });
  });
  it("rejects unauthorized rebinding, case aliases, missing aliases and foreign vault ownership", async () => {
    const target = await project(peer),
      row = await channel(target.id),
      allowed = await vault(),
      forbidden = await vault();
    const external = await vault(foreign),
      own = await vault(actor);
    await bind(row.id, allowed);
    await grant("quyan:developer:UpdatePushChannel", arn(target.id, row.id));
    await grant("quyan:developer:UseSecret", allowed.resource);
    await expect(
      run(() => service.updatePushChannel(target.id, row.id, actor, { secretReference: forbidden.reference })),
    ).rejects.toMatchObject({ statusCode: 403 });
    for (const reference of [
      external.reference,
      own.reference,
      { ...allowed.reference, secretInstanceId: allowed.instance.id.toUpperCase() },
      { ...allowed.reference, alias: "MISSING" },
    ])
      await expect(
        run(() => service.updatePushChannel(target.id, row.id, actor, { secretReference: reference })),
      ).rejects.toMatchObject({ statusCode: 400 });
    expect((await prisma.developerPushChannel.findUniqueOrThrow({ where: { id: row.id } })).secretAlias).toBe(
      allowed.secret.alias,
    );
    await prisma.developerSecret.update({ where: { id: allowed.secret.id }, data: { status: 0 } });
    await expect(
      run(() => service.updatePushChannel(target.id, row.id, actor, { enabled: true })),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
  it.each(["reference", "endpoint", "enabled"] as const)(
    "rejects a concurrent %s change even when the database timestamp is unchanged",
    async (field) => {
      const target = await project(peer),
        row = await channel(target.id),
        secret = await vault();
      const snapshot = await bind(row.id, secret);
      await grant("quyan:developer:UpdatePushChannel", arn(target.id, row.id));
      await grant("quyan:developer:UseSecret", secret.resource);
      const safeUrl = outbound.assertSafeOutboundUrl;
      vi.spyOn(outbound, "assertSafeOutboundUrl").mockImplementation(async (value) => {
        await prisma.developerPushChannel.update({
          where: { id: row.id },
          data: {
            updateTime: snapshot.updateTime,
            ...(field === "reference"
              ? { config: { secretInstanceId: "different-fixture", secretProjectId: secret.backing.id } }
              : field === "endpoint"
                ? { endpoint: endpoint + "-concurrent" }
                : { enabled: false }),
          },
        });
        return safeUrl(value);
      });
      await expect(
        run(() => service.updatePushChannel(target.id, row.id, actor, { endpoint: endpoint + "-must-not-write" })),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect((await prisma.developerPushChannel.findUniqueOrThrow({ where: { id: row.id } })).endpoint).not.toBe(
        endpoint + "-must-not-write",
      );
    },
  );
  it.each(["instance", "entitlement", "expired-entitlement", "future-entitlement", "project", "secret"] as const)(
    "refuses an unavailable %s credential target without decrypting",
    async (kind) => {
      const target = await project(peer),
        secret = await vault();
      await grant("quyan:developer:CreatePushChannel", projectArn(target.id));
      await grant("quyan:developer:UseSecret", secret.resource);
      const decrypt = vi.spyOn(DeveloperProjectRepository.getInstance(), "resolveSecret");
      if (kind === "instance")
        await prisma.developerProductInstance.update({ where: { id: secret.instance.id }, data: { enabled: false } });
      if (kind === "entitlement")
        await prisma.developerProductEntitlement.update({
          where: { id: secret.entitlement.id },
          data: { enabled: false },
        });
      if (kind === "expired-entitlement")
        await prisma.developerProductEntitlement.update({
          where: { id: secret.entitlement.id },
          data: { expiresAt: new Date(Date.now() - 60000) },
        });
      if (kind === "future-entitlement")
        await prisma.developerProductEntitlement.update({
          where: { id: secret.entitlement.id },
          data: { startsAt: new Date(Date.now() + 60000) },
        });
      if (kind === "project")
        await prisma.developerProject.update({ where: { id: secret.backing.id }, data: { status: 0 } });
      if (kind === "secret")
        await prisma.developerSecret.update({ where: { id: secret.secret.id }, data: { status: 0 } });
      await expect(
        run(() => service.createPushChannel(target.id, actor, { ...body(), secretReference: secret.reference })),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(await prisma.developerPushChannel.count({ where: { projectId: target.id } })).toBe(0);
      expect(decrypt).not.toHaveBeenCalled();
    },
  );
  it("does not persist credential bindings without a resolved authorized target", async () => {
    const target = await project(peer),
      row = await channel(target.id),
      secret = await vault();
    const repository = DeveloperPushChannelRepository.getInstance();
    await expect(
      repository.create(target.id, peer, { ...body(), secretReference: secret.reference }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await bind(row.id, secret);
    const snapshot = await repository.snapshot(target.id, peer, row.id);
    await expect(repository.update(snapshot, peer, { enabled: true })).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerPushChannel.count({ where: { projectId: target.id } })).toBe(1);
  });
  it("revalidates a selected instance backing project before committing", async () => {
    const target = await project(peer),
      secret = await vault(),
      replacement = await project(peer);
    await grant("quyan:developer:CreatePushChannel", projectArn(target.id));
    await grant("quyan:developer:UseSecret", secret.resource);
    await prisma.developerSecret.create({
      data: {
        projectId: replacement.id,
        alias: "TOKEN",
        ciphertext: "fixture-only",
        iv: "fixture-only",
        authTag: "fixture-only",
      },
    });
    const safeUrl = outbound.assertSafeOutboundUrl;
    vi.spyOn(outbound, "assertSafeOutboundUrl").mockImplementation(async (value) => {
      await prisma.developerProductInstance.update({
        where: { id: secret.instance.id },
        data: { backingProjectId: replacement.id },
      });
      return safeUrl(value);
    });
    await expect(
      run(() => service.createPushChannel(target.id, actor, { ...body(), secretReference: secret.reference })),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerPushChannel.count({ where: { projectId: target.id } })).toBe(0);
  });
  it.each(["create", "update"] as const)("revalidates the active owner after URL validation for %s", async (action) => {
    const target = await project(peer),
      row = await channel(target.id);
    await grant("quyan:developer:CreatePushChannel", projectArn(target.id));
    await grant("quyan:developer:UpdatePushChannel", arn(target.id, row.id));
    const safeUrl = outbound.assertSafeOutboundUrl;
    vi.spyOn(outbound, "assertSafeOutboundUrl").mockImplementation(async (value) => {
      await prisma.user.update({ where: { id: peer }, data: { status: 0 } });
      return safeUrl(value);
    });
    await expect(
      run(() =>
        action === "create"
          ? service.createPushChannel(target.id, actor, body())
          : service.updatePushChannel(target.id, row.id, actor, { endpoint: endpoint + "-must-not-write" }),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await prisma.developerPushChannel.count({ where: { projectId: target.id } })).toBe(1);
    expect((await prisma.developerPushChannel.findUniqueOrThrow({ where: { id: row.id } })).endpoint).toBe(endpoint);
  });
  it("keeps SSRF protection and refuses broken legacy credential bindings on sensitive writes", async () => {
    const target = await project(peer),
      row = await channel(target.id);
    await grant("quyan:developer:CreatePushChannel", projectArn(target.id));
    await grant("quyan:developer:UpdatePushChannel", arn(target.id, row.id));
    await expect(
      run(() => service.createPushChannel(target.id, actor, { ...body(), endpoint: "http://127.0.0.1/private" })),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      run(() => service.updatePushChannel(target.id, row.id, actor, { endpoint: "http://127.0.0.1/private" })),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.developerPushChannel.update({ where: { id: row.id }, data: { secretAlias: "TOKEN" } });
    await expect(
      run(() => service.updatePushChannel(target.id, row.id, actor, { endpoint: endpoint + "-other" })),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await run(() => service.updatePushChannel(target.id, row.id, actor, { enabled: false }))).enabled).toBe(
      false,
    );
  });
  it("checks exact channel/project identity, account and active status", async () => {
    const target = await project(peer),
      other = await project(peer),
      outside = await project(foreign);
    const row = await channel(target.id),
      external = await channel(outside.id);
    await grant(
      ["quyan:developer:UpdatePushChannel", "quyan:developer:DeletePushChannel"],
      "acs:developer:*:" + owner + ":push-channel/*/*",
    );
    for (const [p, id] of [
      [other.id, row.id],
      [outside.id, external.id],
      [target.id, row.id.toUpperCase()],
    ]) {
      await expect(run(() => service.updatePushChannel(p, id, actor, { enabled: false }))).rejects.toMatchObject({
        statusCode: 404,
      });
      await expect(run(() => service.deletePushChannel(p, id, actor))).rejects.toMatchObject({ statusCode: 404 });
    }
    await prisma.developerPushChannel.update({ where: { id: row.id }, data: { status: 0 } });
    await expect(
      run(() => service.updatePushChannel(target.id, row.id, actor, { enabled: false })),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(run(() => service.deletePushChannel(target.id, row.id, actor))).rejects.toMatchObject({
      statusCode: 404,
    });
  });
  it("reflects resource-group member removal immediately and excludes aliases or inactive rows", async () => {
    const target = await project(peer),
      row = await channel(target.id),
      other = await project(peer);
    const group = await ram.createResourceGroup(owner, { name: "push-group-" + randomUUID() });
    const full = await ram.addResourceGroupMember(owner, group.id, { resourceArn: arn(target.id, row.id) });
    const policy = await ram.createPolicy(owner, {
      name: "push-group-policy-" + randomUUID(),
      document: {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: ["quyan:developer:ListPushChannels", "quyan:developer:DeletePushChannel"],
          Resource: "acs:developer:*:" + owner + ":push-channel/*/*",
        },
      },
    });
    await ram.createAuthorization(owner, {
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "resource-group",
      scopeResourceId: group.id,
    });
    expect((await run(() => service.listPushChannelsPage(target.id, actor))).items).toHaveLength(1);
    await ram.removeResourceGroupMember(owner, group.id, full.members[0].id);
    expect((await run(() => service.listPushChannelsPage(target.id, actor))).items).toEqual([]);
    await expect(run(() => service.deletePushChannel(target.id, row.id, actor))).rejects.toMatchObject({
      statusCode: 403,
    });
    const groups = RamResourceGroupRepository.getInstance();
    expect(await groups.resourceExistsInAccount(arn(target.id, row.id), owner)).toBe(true);
    expect(await groups.resourceExistsInAccount(arn(other.id, row.id), owner)).toBe(false);
    expect(await groups.resourceExistsInAccount(arn(target.id, row.id.toUpperCase()), owner)).toBe(false);
    await prisma.developerPushChannel.update({ where: { id: row.id }, data: { status: 0 } });
    expect(await groups.resourceExistsInAccount(arn(target.id, row.id), owner)).toBe(false);
  });
  it("uses role grants rather than caller grants and checks revoked sessions and AccessKey principals", async () => {
    const target = await project(peer),
      row = await channel(target.id);
    await grant("quyan:developer:UpdatePushChannel", arn(target.id, row.id));
    const role = await prisma.ramRole.create({ data: { name: "push-role-" + randomUUID(), accountOwnerId: owner } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "Push fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const auth = { roleSessionId: session.id, assumedRoleId: role.id };
    await expect(
      run(() => service.updatePushChannel(target.id, row.id, actor, { enabled: false }), auth),
    ).rejects.toMatchObject({ statusCode: 403 });
    await grant("quyan:developer:UpdatePushChannel", arn(target.id, row.id), "Allow", "role", role.id);
    expect(
      (await run(() => service.updatePushChannel(target.id, row.id, actor, { enabled: false }), auth)).enabled,
    ).toBe(false);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(
      run(() => service.updatePushChannel(target.id, row.id, actor, { enabled: true }), auth),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(
      (
        await run(() => service.updatePushChannel(target.id, row.id, actor, { enabled: true }), {
          subjectType: "access_key",
        })
      ).enabled,
    ).toBe(true);
  });
  it("fails closed on provider failure even for an empty page and rejects subject impersonation", async () => {
    const target = await project(peer),
      row = await channel(target.id);
    await expect(run(() => service.listPushChannelsPage(target.id, actor, { page: 0 }))).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(
      run(() => service.updatePushChannel(target.id, row.id, peer, { enabled: false })),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.developerPushChannel.delete({ where: { id: row.id } });
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockRejectedValue(
      new Error("provider-unavailable"),
    );
    await expect(run(() => service.listPushChannelsPage(target.id, actor))).rejects.toThrow("provider-unavailable");
    await expect(run(() => service.deletePushChannel(target.id, row.id, actor))).rejects.toThrow(
      "provider-unavailable",
    );
  });
  it.each(["legacy", "shadow"] as const)("keeps personal ownership in %s", async (mode) => {
    const own = await project(actor),
      delegated = await project(peer),
      row = await channel(own.id),
      other = await channel(delegated.id);
    await grant("quyan:developer:UpdatePushChannel", arn(delegated.id, other.id));
    env.security.iamAuthorizationMode = mode;
    expect((await run(() => service.updatePushChannel(own.id, row.id, actor, { enabled: false }))).enabled).toBe(false);
    await expect(
      run(() => service.updatePushChannel(delegated.id, other.id, actor, { enabled: false })),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect((await run(() => service.listPushChannelsPage(own.id, actor))).items).toHaveLength(1);
  });
});
