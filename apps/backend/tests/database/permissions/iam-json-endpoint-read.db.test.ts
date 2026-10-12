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
