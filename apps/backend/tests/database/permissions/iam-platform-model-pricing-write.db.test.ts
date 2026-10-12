import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { PlatformModelPricingWriteIamService } from "@/services/relay/platform-model-pricing-write-iam.service";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { ModelPricingService } from "@/services/relay/model-pricing.service";
import { PlatformModelPricingWriteRepository } from "@/store/relay/platform-model-pricing-write.repository";
import { ModelPricingRepository } from "@/store/relay/model-pricing.repository";
import {
  platformModelPricingArn,
  platformModelPricingCollectionArn,
} from "@/iam/resources/platform-model-pricing-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string;
const originalMode = env.security.iamAuthorizationMode,
  service = ModelPricingService.getInstance(),
  repo = PlatformModelPricingWriteRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "model-pricing-write-" + randomUUID(),
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
  prisma.modelPricing.create({
    data: { model, inputPrice: 1.25, outputPrice: 2.5, pricingType: "token-based", provider: "fixture provider" },
  });
async function group() {
  const row = await prisma.group.create({
    data: {
      username: "model-pricing-write-" + randomUUID(),
      name: "fixture global",
      level: 0,
      accountOwnerId: null,
      permissions: [Permission.MODEL_PRICING_UPDATE],
    },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: row.id } });
  return row;
}
async function bind(document: unknown, principalType = "user", principalId = actor) {
  const parsed = parseIamPolicy(document);
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "model-pricing-write-" + randomUUID(),
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
  await prisma.modelPricing.deleteMany();
  owner = await user();
  actor = await user(owner);
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
});
const input = { model: "provider/model:v1", pricingType: "token-based" as const, inputPrice: 1.25, outputPrice: 2.5 };
describe("platform model pricing write transactions", () => {
  it("creates, renames, updates and deletes using immutable actual record IDs", async () => {
    await group();
    const row = await service.createManagedModelPricing(input, actor, request());
    expect(row).toMatchObject({
      ...input,
      cacheCreationMultiplier: 1.25,
      cacheReadMultiplier: 0.1,
      supportedFormats: "openai-chat-completions,anthropic,gemini",
    });
    const updated = await service.updateManagedModelPricing(
      row.id!,
      { model: "renamed/model", inputPrice: 3.5, cacheReadMultiplier: 0 },
      actor,
      request(),
    );
    expect(updated).toMatchObject({
      id: row.id,
      model: "renamed/model",
      inputPrice: 3.5,
      outputPrice: 2.5,
      cacheReadMultiplier: 0,
    });
    await service.deleteManagedModelPricing(row.id!, actor, request());
    expect(await prisma.modelPricing.findUnique({ where: { id: row.id } })).toMatchObject({ status: 0 });
  });
  it("checks both the creation control and actual generated resource", async () => {
    await group();
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:model_pricing:CreatePricing",
        Resource: platformModelPricingCollectionArn(),
      },
    });
    await expect(service.createManagedModelPricing(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.modelPricing.count()).toBe(0);
  });
  it("rolls back a generated row when its real ARN is denied", async () => {
    await group();
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:model_pricing:CreatePricing",
        Resource: "acs:platform:*:platform:model-pricing/*",
      },
    });
    await expect(service.createManagedModelPricing(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.modelPricing.count()).toBe(0);
  });
  it("restores a deleted record without changing its identity", async () => {
    await group();
    const row = await create(input.model);
    await prisma.modelPricing.update({ where: { id: row.id }, data: { status: 0 } });
    expect(await service.createManagedModelPricing(input, actor, request())).toMatchObject({ id: row.id });
    expect(await prisma.modelPricing.count()).toBe(1);
  });
  it("does not bypass Deny by restoring a deleted model", async () => {
    await group();
    const row = await create(input.model);
    await prisma.modelPricing.update({ where: { id: row.id }, data: { status: 0 } });
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:model_pricing:CreatePricing",
        Resource: platformModelPricingArn(row.id),
      },
    });
    await expect(service.createManagedModelPricing(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.modelPricing.findUnique({ where: { id: row.id } })).toMatchObject({ status: 0 });
  });
  it.each(["update", "delete"] as const)("rejects a record Deny for %s", async (operation) => {
    await group();
    const row = await create(input.model);
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: operation === "update" ? "quyan:model_pricing:UpdatePricing" : "quyan:model_pricing:DeletePricing",
        Resource: platformModelPricingArn(row.id),
      },
    });
    const result =
      operation === "update"
        ? service.updateManagedModelPricing(row.id, { inputPrice: 9 }, actor, request())
        : service.deleteManagedModelPricing(row.id, actor, request());
    await expect(result).rejects.toMatchObject({ statusCode: 403 });
    const current = await prisma.modelPricing.findUniqueOrThrow({ where: { id: row.id } });
    expect(current.status).toBe(1);
    expect(Number(current.inputPrice)).toBe(1.25);
  });
  it("requires persisted global eligibility despite account-wide Allow", async () => {
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(service.createManagedModelPricing(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    const global = await group();
    await prisma.group.update({ where: { id: global.id }, data: { accountOwnerId: owner } });
    await expect(service.createManagedModelPricing(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.modelPricing.count()).toBe(0);
  });
  it("rejects a stale record before updating it", async () => {
    await group();
    const row = await create(input.model),
      original = repo.update.bind(repo);
    vi.spyOn(repo, "update").mockImplementation(async (target, data, guard) => {
      await prisma.modelPricing.update({
        where: { id: row.id },
        data: { inputPrice: 8, updateTime: new Date(Date.now() + 1000) },
      });
      return original(target, data, guard);
    });
    await expect(service.updateManagedModelPricing(row.id, { inputPrice: 9 }, actor, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(Number((await prisma.modelPricing.findUniqueOrThrow({ where: { id: row.id } })).inputPrice)).toBe(8);
  });
  it("rejects global eligibility revoked before the transaction", async () => {
    const global = await group(),
      original = repo.create.bind(repo);
    vi.spyOn(repo, "create").mockImplementation(async (data, guard) => {
      await prisma.group.update({ where: { id: global.id }, data: { permissions: [] } });
      return original(data, guard);
    });
    await expect(service.createManagedModelPricing(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.modelPricing.count()).toBe(0);
  });
  it.each(["update", "delete"] as const)("rolls back %s when final authorization is denied", async (operation) => {
    await group();
    const row = await create(input.model),
      iam = IamAuthorizationService.getInstance(),
      original = iam.authorize.bind(iam);
    let calls = 0;
    vi.spyOn(iam, "authorize").mockImplementation(async (input) => {
      if (
        input.action ===
          (operation === "update" ? "quyan:model_pricing:UpdatePricing" : "quyan:model_pricing:DeletePricing") &&
        ++calls >= 4
      )
        return { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] };
      return original(input);
    });
    const result =
      operation === "update"
        ? service.updateManagedModelPricing(row.id, { inputPrice: 9 }, actor, request())
        : service.deleteManagedModelPricing(row.id, actor, request());
    await expect(result).rejects.toMatchObject({ statusCode: 403 });
    const current = await prisma.modelPricing.findUniqueOrThrow({ where: { id: row.id } });
    expect(current.status).toBe(1);
    expect(Number(current.inputPrice)).toBe(1.25);
  });
  it("validates merged pricing modes and accepts zero fixed price", async () => {
    await group();
    const row = await create(input.model);
    await expect(
      service.updateManagedModelPricing(row.id, { pricingType: "per-request" }, actor, request()),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(
      await service.updateManagedModelPricing(row.id, { pricingType: "per-request", fixedPrice: 0 }, actor, request()),
    ).toMatchObject({ pricingType: "per-request", fixedPrice: 0 });
    await expect(
      service.createManagedModelPricing({ ...input, model: "invalid", supportedFormats: "all" }, actor, request()),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.createManagedModelPricing(input, actor, request())).rejects.toMatchObject({ statusCode: 409 });
  });
  it("requires explicit role grants and respects session revocation", async () => {
    await group();
    const row = await create(input.model),
      role = await prisma.ramRole.create({
        data: { accountOwnerId: owner, name: "model-pricing-write-" + randomUUID() },
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
    const req = request();
    Object.assign(req.authContext!, { assumedRoleId: role.id, roleSessionId: session.id });
    await expect(service.updateManagedModelPricing(row.id, { inputPrice: 9 }, actor, req)).rejects.toMatchObject({
      statusCode: 403,
    });
    await bind(
      {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "quyan:model_pricing:UpdatePricing",
          Resource: platformModelPricingArn(row.id),
        },
      },
      "role",
      role.id,
    );
    expect(await service.updateManagedModelPricing(row.id, { inputPrice: 9 }, actor, req)).toMatchObject({
      id: row.id,
      inputPrice: 9,
    });
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.deleteManagedModelPricing(row.id, actor, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("shadow is read-only for IAM and performs exactly one legacy write", async () => {
    await group();
    env.security.iamAuthorizationMode = "shadow";
    await bind({ Version: "1", Statement: { Effect: "Deny", Action: "quyan:model_pricing:*", Resource: "*" } });
    const native = vi.spyOn(repo, "create"),
      legacy = vi.spyOn(ModelPricingRepository.getInstance(), "create");
    await service.createManagedModelPricing(input, actor, request());
    expect(native).not.toHaveBeenCalled();
    expect(legacy).toHaveBeenCalledOnce();
    expect(await prisma.modelPricing.count()).toBe(1);
  });
  it("pure shadow preparation does not persist any mutation", async () => {
    await group();
    const row = await create(input.model),
      native = PlatformModelPricingWriteIamService.getInstance();
    await native.create({ ...input, model: "other" }, actor, request(), false);
    await native.mutate("update", row.id, { inputPrice: 9 }, actor, request(), false);
    await native.mutate("delete", row.id, {}, actor, request(), false);
    expect(await prisma.modelPricing.count()).toBe(1);
    expect(Number((await prisma.modelPricing.findUniqueOrThrow({ where: { id: row.id } })).inputPrice)).toBe(1.25);
  });
});
