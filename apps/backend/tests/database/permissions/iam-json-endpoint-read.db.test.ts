import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { JsonEndpointManagementRepository } from "@/store/system/json-endpoint-management.repository";
import { JsonEndpointIamService } from "@/services/json-endpoint/json-endpoint-iam.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { jsonEndpointArn } from "@/iam/resources/json-endpoint-resources";
import { jsonEndpointResourceResolver } from "@/iam/request/json-endpoint-resource-resolvers";
import type { IamPrincipal } from "@quyan/shared";
import { Permission } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
const repository = JsonEndpointManagementRepository.getInstance(),
  service = JsonEndpointIamService.getInstance();
let owner: string, actor: string, peer: string, foreign: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "json-fixture-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
beforeEach(async () => {
  owner = await user();
  actor = await user(owner);
  peer = await user(owner);
  foreign = await user();
});
const principal = (accountOwnerId = owner): IamPrincipal => ({
  subjectUserId: actor,
  principalUserId: actor,
  accountOwnerId,
  subjectType: "sub_user",
});
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    params: {},
    headers: {},
  }) as unknown as TypedRequest;
const endpoint = (userId = actor) =>
  prisma.jsonEndpoint.create({
    data: {
      userId,
      name: "private-endpoint",
      slug: "fixture-" + randomUUID(),
      jsonContent: { private: true },
      isPublic: false,
      accessMode: "static-password",
      apiKey: "fixture-password-hash-" + randomUUID(),
    },
  });
async function bind(document: unknown) {
  const parsed = parseIamPolicy(document);
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "json-policy-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  return prisma.ramAuthorization.create({
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
}
describe("JSON Endpoint scoped reads", () => {
  it("scans account-isolated metadata only and strips password hashes from public hydration", async () => {
    const own = await endpoint(),
      same = await endpoint(peer);
    await endpoint(foreign);
    const targets = await repository.scan(principal());
    expect(new Set(targets.map((t) => t.id))).toEqual(new Set([own.id, same.id]));
    for (const t of targets) {
      expect(t).not.toHaveProperty("jsonContent");
      expect(t).not.toHaveProperty("apiKey");
      expect(t).not.toHaveProperty("name");
    }
    expect((await repository.scan(principal(), peer)).map((t) => t.id)).toEqual([same.id]);
    const views = await repository.hydrate(principal(), targets);
    expect(views.every((v) => v.hasPassword && !("apiKey" in v))).toBe(true);
    expect(views[0].jsonContent).toEqual({ private: true });
    await expect(repository.assertOwner(principal(), foreign)).rejects.toMatchObject({ statusCode: 403 });
    expect(await repository.target(principal(), (await endpoint(foreign)).id)).toBeNull();
    await expect(repository.scan(principal(foreign))).rejects.toMatchObject({ statusCode: 403 });
  });
  it("checks real resource-group membership and resolves actual same-account owners", async () => {
    const selected = await endpoint(peer),
      req = request();
    req.params.id = selected.id;
    const arn = jsonEndpointArn(owner, peer, selected.id);
    expect(await jsonEndpointResourceResolver({ principal: principal(), request: req })).toBe(arn);
    const groups = RamResourceGroupRepository.getInstance();
    expect(await groups.resourceExistsInAccount(arn, owner)).toBe(true);
    expect(await groups.resourceExistsInAccount(jsonEndpointArn(owner, actor, selected.id), owner)).toBe(false);
    expect(await groups.resourceExistsInAccount(jsonEndpointArn(foreign, peer, selected.id), foreign)).toBe(false);
    await prisma.user.update({ where: { id: peer }, data: { status: 0 } });
    expect(await groups.resourceExistsInAccount(arn, owner)).toBe(false);
    expect(await jsonEndpointResourceResolver({ principal: principal(), request: req })).toBeUndefined();
  });
  it("does not hydrate changed or deleted endpoints", async () => {
    const selected = await endpoint(),
      target = (await repository.target(principal(), selected.id))!;
    await prisma.jsonEndpoint.update({
      where: { id: selected.id },
      data: { jsonContent: { changed: true }, updateTime: new Date(target.updateTime.getTime() + 1_000) },
    });
    expect(await repository.hydrate(principal(), [target])).toEqual([]);
    const current = (await repository.target(principal(), selected.id))!;
    await prisma.jsonEndpoint.update({ where: { id: selected.id }, data: { status: -1 } });
    expect(await repository.hydrate(principal(), [current])).toEqual([]);
    expect(await repository.target(principal(), selected.id)).toBeNull();
  });
  it("keeps owner names account-scoped and snapshot checked", async () => {
    const targets = await repository.scanOwners(principal());
    expect(new Set(targets.map((t) => t.id))).toEqual(new Set([owner, actor, peer]));
    expect(targets.every((t) => !("username" in t) && !("password" in t))).toBe(true);
    const selected = targets.find((t) => t.id === peer)!;
    await prisma.user.update({
      where: { id: peer },
      data: { name: "changed", updateTime: new Date(selected.updateTime.getTime() + 1_000) },
    });
    expect(await repository.hydrateOwners(principal(), [selected])).toEqual([]);
  });
  it("preserves old Read ownership and expands only Manage within the current account", async () => {
    const own = await endpoint(),
      same = await endpoint(peer);
    await endpoint(foreign);
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.JSON_ENDPOINT_READ] } });
    expect((await service.list(actor, undefined, request())).map((r) => r.id)).toEqual([own.id]);
    await expect(service.get(actor, same.id, request())).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.JSON_ENDPOINT_MANAGE] } });
    expect(new Set((await service.list(actor, undefined, request())).map((r) => r.id))).toEqual(
      new Set([own.id, same.id]),
    );
    expect((await service.get(actor, same.id, request())).userId).toBe(peer);
    await expect(service.list(actor, foreign, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("explicit policies grant an exact peer resource, Deny wins and binding revocation is immediate", async () => {
    const same = await endpoint(peer),
      hidden = await endpoint(peer);
    const binding = await bind({
      Version: "1",
      Statement: [
        {
          Effect: "Allow",
          Action: ["quyan:json_endpoint:ListEndpoints", "quyan:json_endpoint:GetEndpoint"],
          Resource: [jsonEndpointArn(owner, peer, same.id), jsonEndpointArn(owner, peer, hidden.id)],
        },
        { Effect: "Deny", Action: "quyan:json_endpoint:*", Resource: jsonEndpointArn(owner, peer, hidden.id) },
      ],
    });
    expect((await service.list(actor, undefined, request())).map((r) => r.id)).toEqual([same.id]);
    expect((await service.get(actor, same.id, request())).jsonContent).toEqual({ private: true });
    await expect(service.get(actor, hidden.id, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await service.owners(actor, request())).toEqual([]);
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
    expect(await service.list(actor, undefined, request())).toEqual([]);
    await expect(service.get(actor, same.id, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("owner names require independent exact user grants", async () => {
    await bind({
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: "quyan:json_endpoint:ListEndpointOwners",
        Resource: "acs:quyan:*:" + owner + ":user/" + peer,
      },
    });
    const names = await service.owners(actor, request());
    expect(names.map((r) => r.id)).toEqual([peer]);
    expect(Object.keys(names[0]).sort()).toEqual(["id", "username"]);
  });
  it("rejects disabled accounts and forged role sessions before payload access", async () => {
    const selected = await endpoint(),
      target = (await repository.target(principal(), selected.id))!;
    await expect(
      repository.hydrate(
        {
          ...principal(),
          subjectType: "assumed_role",
          assumedRoleId: "foreign-role",
          roleSessionId: "missing-session",
        },
        [target],
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(repository.hydrate(principal(), [target])).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("JSON Endpoint snapshot deletion", () => {
  it("refuses stale, foreign and peer-misbound deletion snapshots", async () => {
    const selected = await endpoint(),
      target = (await repository.target(principal(), selected.id))!;
    await expect(repository.deleteTarget(principal(foreign), target)).rejects.toMatchObject({ statusCode: 403 });
    await expect(repository.deleteTarget(principal(), { ...target, userId: peer })).rejects.toMatchObject({
      statusCode: 403,
    });
    await prisma.jsonEndpoint.update({
      where: { id: selected.id },
      data: { name: "changed", updateTime: new Date(target.updateTime.getTime() + 1_000) },
    });
    await expect(repository.deleteTarget(principal(), target)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.jsonEndpoint.findUnique({ where: { id: selected.id } }))?.status).toBe(1);
  });
  it("soft deletes exactly one authorized snapshot and cannot delete it twice", async () => {
    const selected = await endpoint(peer),
      target = (await repository.target(principal(), selected.id))!;
    const result = await repository.deleteTarget(principal(), target);
    expect(Object.keys(result).sort()).toEqual(["id", "name", "slug", "userId"]);
    expect((await prisma.jsonEndpoint.findUnique({ where: { id: selected.id } }))?.status).toBe(-1);
    await expect(repository.deleteTarget(principal(), target)).rejects.toMatchObject({ statusCode: 403 });
    expect(await repository.target(principal(), selected.id)).toBeNull();
  });
  it("checks account validity and role session inside deletion", async () => {
    const selected = await endpoint(),
      target = (await repository.target(principal(), selected.id))!;
    await expect(
      repository.deleteTarget(
        { ...principal(), subjectType: "assumed_role", assumedRoleId: "role", roleSessionId: "missing" },
        target,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(repository.deleteTarget(principal(), target)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.jsonEndpoint.findUnique({ where: { id: selected.id } }))?.status).toBe(1);
  });
  it("native Delete cannot be rescued by read-only grants and observes binding revocation", async () => {
    const selected = await endpoint(peer),
      resource = jsonEndpointArn(owner, peer, selected.id);
    await bind({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:json_endpoint:GetEndpoint", Resource: resource },
    });
    await expect(service.delete(actor, selected.id, request())).rejects.toMatchObject({ statusCode: 403 });
    const deletion = await bind({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:json_endpoint:DeleteEndpoint", Resource: resource },
    });
    await prisma.ramAuthorization.update({ where: { id: deletion.id }, data: { status: -1 } });
    await expect(service.delete(actor, selected.id, request())).rejects.toMatchObject({ statusCode: 403 });
    await prisma.ramAuthorization.update({ where: { id: deletion.id }, data: { status: 1 } });
    expect((await service.delete(actor, selected.id, request())).id).toBe(selected.id);
    expect((await prisma.jsonEndpoint.findUnique({ where: { id: selected.id } }))?.status).toBe(-1);
  });
});

describe("JSON Endpoint versioned configuration updates", () => {
  it("retains access hashes internally but never returns them after update", async () => {
    const selected = await endpoint(),
      target = (await repository.target(principal(), selected.id))!;
    expect((await repository.readConfiguration(principal(), target))?.apiKey).toBe(selected.apiKey);
    const updated = await repository.updateTarget(principal(), target, { name: "updated" });
    expect(updated.name).toBe("updated");
    expect(updated.updateTime.getTime()).toBeGreaterThan(target.updateTime.getTime());
    expect(updated.hasPassword).toBe(true);
    expect(updated).not.toHaveProperty("apiKey");
    await expect(repository.updateTarget(principal(), target, { name: "stale" })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await repository.readConfiguration(principal(), target)).toBeNull();
    expect((await prisma.jsonEndpoint.findUnique({ where: { id: selected.id } }))?.name).toBe("updated");
  });
  it("checks account and resource ownership in the update transaction", async () => {
    const selected = await endpoint(),
      target = (await repository.target(principal(), selected.id))!;
    await expect(repository.updateTarget(principal(foreign), target, { name: "bad" })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      repository.updateTarget(principal(), { ...target, userId: peer }, { name: "bad" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    await expect(repository.updateTarget(principal(), target, { name: "bad" })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await prisma.jsonEndpoint.findUnique({ where: { id: selected.id } }))?.name).toBe(selected.name);
  });
  it("allows exact peer updates but requires a separate root-slug grant and observes revocation", async () => {
    const selected = await endpoint(peer),
      resource = jsonEndpointArn(owner, peer, selected.id);
    const binding = await bind({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:json_endpoint:UpdateEndpoint", Resource: resource },
    });
    const state = await service.configuration(actor, selected.id, request());
    await expect(
      service.update(actor, state, { isRootSlug: true, rootSlug: selected.slug }, true, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await service.update(actor, state, { name: "updated" }, false, request())).name).toBe("updated");
    const current = await service.configuration(actor, selected.id, request());
    await bind({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:json_endpoint:SetRootSlug", Resource: resource },
    });
    expect(
      (await service.update(actor, current, { isRootSlug: true, rootSlug: selected.slug }, true, request())).isRootSlug,
    ).toBe(true);
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
    await expect(service.configuration(actor, selected.id, request())).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("JSON Endpoint creation ownership and transactions", () => {
  const input = (userId: string) => ({
    userId,
    name: "fixture",
    slug: "new-" + randomUUID(),
    jsonContent: {},
    isPublic: true,
    isRootSlug: false,
    rootSlug: null,
  });
  it("checks the owner revision and account during the creation transaction", async () => {
    const selected = (await repository.creationOwner(principal(), peer))!,
      data = input(peer);
    await expect(repository.createTarget(principal(foreign), selected, data)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(repository.createTarget(principal(), selected, { ...data, userId: actor })).rejects.toMatchObject({
      statusCode: 403,
    });
    await prisma.user.update({
      where: { id: peer },
      data: { name: "changed", updateTime: new Date(selected.updateTime.getTime() + 1_000) },
    });
    await expect(repository.createTarget(principal(), selected, data)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.jsonEndpoint.count({ where: { userId: peer } })).toBe(0);
    const result = await repository.createTarget(
      principal(),
      (await repository.creationOwner(principal(), peer))!,
      data,
    );
    expect(result.userId).toBe(peer);
    expect(result).not.toHaveProperty("apiKey");
  });
  it("old Create cannot assign a peer owner or create a root slug", async () => {
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.JSON_ENDPOINT_CREATE] } });
    const state = await service.authorizeCreation(actor, actor, false, request());
    expect((await service.create(actor, state, input(actor), request())).userId).toBe(actor);
    await expect(service.authorizeCreation(actor, peer, false, request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.authorizeCreation(actor, actor, true, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("exact peer-parent grants support creation but never cross-account assignment", async () => {
    const grant = await bind({
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: "quyan:json_endpoint:CreateEndpoint",
        Resource: "acs:quyan:*:" + owner + ":user/" + peer,
      },
    });
    const state = await service.authorizeCreation(actor, peer, false, request());
    await expect(service.authorizeCreation(actor, foreign, false, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    await prisma.ramAuthorization.update({ where: { id: grant.id }, data: { status: -1 } });
    await expect(service.create(actor, state, input(peer), request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.jsonEndpoint.count({ where: { userId: peer } })).toBe(0);
  });
  it("root-slug creation needs its own grant on the target owner and retains namespace uniqueness", async () => {
    await bind({
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: ["quyan:json_endpoint:CreateEndpoint", "quyan:json_endpoint:SetRootSlug"],
        Resource: "acs:quyan:*:" + owner + ":user/" + peer,
      },
    });
    const state = await service.authorizeCreation(actor, peer, true, request()),
      data = input(peer);
    const created = await service.create(actor, state, { ...data, isRootSlug: true, rootSlug: data.slug }, request());
    expect(created.isRootSlug).toBe(true);
    expect(await repository.rootSlugExists(data.slug)).toBe(true);
    expect(await repository.userSlugExists(peer, data.slug)).toBe(true);
    await expect(
      repository.createTarget(principal(), state.owner, { ...input(peer), isRootSlug: true, rootSlug: data.slug }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
