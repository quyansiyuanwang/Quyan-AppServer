import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { PlatformOjPricingWriteIamService } from "@/services/oj-submitter/platform-oj-pricing-write-iam.service";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { OJPricingService } from "@/services/oj-submitter/oj-pricing.service";
import { PlatformOjPricingWriteRepository } from "@/store/oj-submitter/platform-oj-pricing-write.repository";
import { OJModelPricingRepository } from "@/store/oj-submitter/oj-model-pricing.repository";
import { platformOjPricingArn, platformOjPricingCollectionArn } from "@/iam/resources/platform-oj-pricing-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string;
const originalMode = env.security.iamAuthorizationMode,
  service = OJPricingService.getInstance(),
  repo = PlatformOjPricingWriteRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "pricing-write-" + randomUUID(),
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
    headers: {},
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
  }) as unknown as TypedRequest;
const create = (model: string) =>
  prisma.oJModelPricing.create({
    data: { model, inputPrice: 1.25, outputPrice: 2.5, multiplier: 1.5, provider: "fixture provider" },
  });
async function group() {
  const row = await prisma.group.create({
    data: {
      username: "pricing-write-" + randomUUID(),
      name: "fixture global",
      level: 0,
      accountOwnerId: null,
      permissions: [Permission.OJ_PRICING_UPDATE],
    },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: row.id } });
  return row;
}
async function bind(document: unknown, principalType = "user", principalId = actor) {
  const parsed = parseIamPolicy(document);
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "pricing-write-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
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
  await prisma.oJModelPricing.deleteMany();
  owner = await user();
  actor = await user(owner);
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
});
const input = { model: "provider/model:v1", inputPrice: 1.25, outputPrice: 2.5 };
describe("platform OJ pricing write transactions", () => {
  it("creates, updates and deletes by actual immutable record IDs", async () => {
    await group();
    const row = await service.createManagedPricing(input, actor, request());
    expect(row).toMatchObject({ ...input, multiplier: 1, cacheCreationMultiplier: 1.25, cacheReadMultiplier: 0.1 });
    const updated = await service.updateManagedPricing(
      input.model,
      { inputPrice: 3.5, cacheReadMultiplier: 0 },
      actor,
      request(),
    );
    expect(updated).toMatchObject({ id: row.id, inputPrice: 3.5, outputPrice: 2.5, cacheReadMultiplier: 0 });
    await service.deleteManagedPricing(input.model, actor, request());
    expect(await prisma.oJModelPricing.findUnique({ where: { id: row.id } })).toMatchObject({ status: 0 });
  });
  it("rejects a denied creation boundary before any row exists", async () => {
    await group();
    await bind({
      Version: "1",
      Statement: { Effect: "Deny", Action: "quyan:oj:CreatePricing", Resource: platformOjPricingCollectionArn() },
    });
    await expect(service.createManagedPricing(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.oJModelPricing.count()).toBe(0);
  });
  it("rolls back a generated row when its real resource is denied", async () => {
    await group();
    await bind({
      Version: "1",
      Statement: { Effect: "Deny", Action: "quyan:oj:CreatePricing", Resource: "acs:platform:*:platform:oj-pricing/*" },
    });
    await expect(service.createManagedPricing(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.oJModelPricing.count()).toBe(0);
  });
  it.each(["update", "delete"] as const)("rejects resource Deny on %s", async (operation) => {
    await group();
    const row = await create(input.model);
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: operation === "update" ? "quyan:oj:UpdatePricing" : "quyan:oj:DeletePricing",
        Resource: platformOjPricingArn(row.id),
      },
    });
    const result =
      operation === "update"
        ? service.updateManagedPricing(row.model, { inputPrice: 9 }, actor, request())
        : service.deleteManagedPricing(row.model, actor, request());
    await expect(result).rejects.toMatchObject({ statusCode: 403 });
    const current = await prisma.oJModelPricing.findUniqueOrThrow({ where: { id: row.id } });
    expect(current.status).toBe(1);
    expect(Number(current.inputPrice)).toBe(1.25);
  });
  it("does not manufacture platform eligibility through account ownership or wildcard grants", async () => {
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(service.createManagedPricing(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    const root = request();
    root.user!.userId = owner;
    root.authContext!.principalUserId = owner;
    await expect(service.createManagedPricing(input, owner, root)).rejects.toMatchObject({ statusCode: 403 });
    const global = await group();
    await prisma.group.update({ where: { id: global.id }, data: { accountOwnerId: owner } });
    await expect(service.createManagedPricing(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.oJModelPricing.count()).toBe(0);
  });
  it("rejects stale target snapshots before changing prices", async () => {
    await group();
    const row = await create(input.model),
      original = repo.update.bind(repo);
    vi.spyOn(repo, "update").mockImplementation(async (target, data, guard) => {
      await prisma.oJModelPricing.update({
        where: { id: row.id },
        data: { inputPrice: 8, updateTime: new Date(Date.now() + 1000) },
      });
      return original(target, data, guard);
    });
    await expect(service.updateManagedPricing(input.model, { inputPrice: 9 }, actor, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(Number((await prisma.oJModelPricing.findUniqueOrThrow({ where: { id: row.id } })).inputPrice)).toBe(8);
  });
  it("rejects model rebinds between lookup and deletion", async () => {
    await group();
    const row = await create(input.model),
      original = repo.remove.bind(repo);
    vi.spyOn(repo, "remove").mockImplementation(async (target, guard) => {
      await prisma.oJModelPricing.update({ where: { id: row.id }, data: { model: "changed/model" } });
      await create(input.model);
      return original(target, guard);
    });
    await expect(service.deleteManagedPricing(input.model, actor, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await prisma.oJModelPricing.count({ where: { status: 1 } })).toBe(2);
  });
  it("rejects group eligibility revoked before the transaction", async () => {
    const global = await group(),
      original = repo.create.bind(repo);
    vi.spyOn(repo, "create").mockImplementation(async (data, guard) => {
      await prisma.group.update({ where: { id: global.id }, data: { permissions: [] } });
      return original(data, guard);
    });
    await expect(service.createManagedPricing(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.oJModelPricing.count()).toBe(0);
  });
  it.each(["update", "delete"] as const)("rolls back %s if the final decision changes to Deny", async (operation) => {
    await group();
    const row = await create(input.model),
      iam = IamAuthorizationService.getInstance(),
      original = iam.authorize.bind(iam);
    let calls = 0;
    vi.spyOn(iam, "authorize").mockImplementation(async (input) => {
      if (
        input.action === (operation === "update" ? "quyan:oj:UpdatePricing" : "quyan:oj:DeletePricing") &&
        ++calls >= 4
      )
        return { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] };
      return original(input);
    });
    const result =
      operation === "update"
        ? service.updateManagedPricing(row.model, { inputPrice: 9 }, actor, request())
        : service.deleteManagedPricing(row.model, actor, request());
    await expect(result).rejects.toMatchObject({ statusCode: 403 });
    const current = await prisma.oJModelPricing.findUniqueOrThrow({ where: { id: row.id } });
    expect(current.status).toBe(1);
    expect(Number(current.inputPrice)).toBe(1.25);
  });
  it("does not restore soft-deleted pricing or duplicate models", async () => {
    await group();
    const row = await create(input.model);
    await prisma.oJModelPricing.update({ where: { id: row.id }, data: { status: 0 } });
    await expect(service.createManagedPricing(input, actor, request())).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.updateManagedPricing(input.model, { inputPrice: 9 }, actor, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.deleteManagedPricing("missing/model", actor, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await prisma.oJModelPricing.count()).toBe(1);
  });
  it("keeps shadow evaluation read-only and writes through the legacy path exactly once", async () => {
    await group();
    env.security.iamAuthorizationMode = "shadow";
    await bind({ Version: "1", Statement: { Effect: "Deny", Action: "quyan:oj:*", Resource: "*" } });
    const native = vi.spyOn(repo, "create"),
      legacy = vi.spyOn(OJModelPricingRepository.getInstance(), "create");
    await service.createManagedPricing(input, actor, request());
    expect(native).not.toHaveBeenCalled();
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(await prisma.oJModelPricing.count()).toBe(1);
  });
  it("pure shadow preparation never creates or modifies records", async () => {
    await group();
    const native = PlatformOjPricingWriteIamService.getInstance(),
      row = await create(input.model);
    await native.create({ ...input, model: "other" }, actor, request(), false);
    await native.mutate("update", row.model, { inputPrice: 9 }, actor, request(), false);
    await native.mutate("delete", row.model, {}, actor, request(), false);
    expect(await prisma.oJModelPricing.count()).toBe(1);
    expect(Number((await prisma.oJModelPricing.findUniqueOrThrow({ where: { id: row.id } })).inputPrice)).toBe(1.25);
  });
});
