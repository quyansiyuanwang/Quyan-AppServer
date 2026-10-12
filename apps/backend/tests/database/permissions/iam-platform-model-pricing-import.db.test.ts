import { MODEL_PRICING_IMPORT_MAX_ITEMS } from "@/api/schema/relay/model-pricing.schema";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
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
const model = (name: string) => ({ model: name, inputPrice: 9, outputPrice: 10 });
describe("platform model pricing atomic import database", () => {
  it("accepts the full registered batch limit and rejects overflow before writing", async () => {
    await group();
    const models = Array.from({ length: MODEL_PRICING_IMPORT_MAX_ITEMS }, (_, i) => model("limit-" + i));
    expect(await service.importManagedModelPricing(models, actor, request())).toEqual({
      created: models.length,
      updated: 0,
      total: models.length,
    });
    await expect(
      service.importManagedModelPricing([...models, model("overflow")], actor, request()),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await prisma.modelPricing.count()).toBe(models.length);
  });
  it("updates, restores and creates every record in one authorized batch", async () => {
    await group();
    const active = await create("active"),
      deleted = await create("deleted");
    await prisma.modelPricing.update({ where: { id: deleted.id }, data: { status: 0 } });
    expect(
      await service.importManagedModelPricing(
        [model("active"), model("deleted"), { ...model("new"), pricingType: "per-request", fixedPrice: 0 }],
        actor,
        request(),
      ),
    ).toEqual({ created: 1, updated: 2, total: 3 });
    expect(await prisma.modelPricing.count()).toBe(3);
    const rows = await prisma.modelPricing.findMany();
    expect(rows.every((row) => row.status === 1 && Number(row.inputPrice) === 9)).toBe(true);
    expect(rows.find((row) => row.id === active.id)?.model).toBe("active");
    expect(rows.find((row) => row.id === deleted.id)?.model).toBe("deleted");
    expect(Number(rows.find((row) => row.model === "new")?.fixedPrice)).toBe(0);
  });
  it("rejects an existing record Deny without updating other records", async () => {
    await group();
    const a = await create("a"),
      b = await create("b");
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:model_pricing:ImportPricing",
        Resource: platformModelPricingArn(b.id),
      },
    });
    await expect(
      service.importManagedModelPricing([model("a"), model("b"), model("new")], actor, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.modelPricing.count()).toBe(2);
    expect(Number((await prisma.modelPricing.findUniqueOrThrow({ where: { id: a.id } })).inputPrice)).toBe(1.25);
  });
  it("retains resource Deny when restoring through import", async () => {
    await group();
    const row = await create("deleted");
    await prisma.modelPricing.update({ where: { id: row.id }, data: { status: 0 } });
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:model_pricing:ImportPricing",
        Resource: platformModelPricingArn(row.id),
      },
    });
    await expect(
      service.importManagedModelPricing([model("deleted"), model("new")], actor, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.modelPricing.count()).toBe(1);
    expect(await prisma.modelPricing.findUnique({ where: { id: row.id } })).toMatchObject({ status: 0 });
  });
  it("rolls back all newly created rows if their actual ARNs are denied", async () => {
    await group();
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:model_pricing:ImportPricing",
        Resource: "acs:platform:*:platform:model-pricing/*",
      },
    });
    await expect(service.importManagedModelPricing([model("a"), model("b")], actor, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await prisma.modelPricing.count()).toBe(0);
  });
  it("requires the import control boundary even for existing records", async () => {
    await group();
    const row = await create("a");
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:model_pricing:ImportPricing",
        Resource: platformModelPricingCollectionArn(),
      },
    });
    await expect(service.importManagedModelPricing([model("a")], actor, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(Number((await prisma.modelPricing.findUniqueOrThrow({ where: { id: row.id } })).inputPrice)).toBe(1.25);
  });
  it("does not overwrite a model introduced between preparation and commit", async () => {
    await group();
    const original = repo.importModels.bind(repo);
    vi.spyOn(repo, "importModels").mockImplementation(async (input, targets, guard) => {
      await create("new");
      return original(input, targets, guard);
    });
    await expect(service.importManagedModelPricing([model("new")], actor, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    const row = await prisma.modelPricing.findUniqueOrThrow({ where: { model: "new" } });
    expect(Number(row.inputPrice)).toBe(1.25);
  });
  it("rejects changed existing snapshots before any imported value is saved", async () => {
    await group();
    const row = await create("a"),
      original = repo.importModels.bind(repo);
    vi.spyOn(repo, "importModels").mockImplementation(async (input, targets, guard) => {
      await prisma.modelPricing.update({
        where: { id: row.id },
        data: { inputPrice: 7, updateTime: new Date(Date.now() + 1000) },
      });
      return original(input, targets, guard);
    });
    await expect(service.importManagedModelPricing([model("a"), model("new")], actor, request())).rejects.toMatchObject(
      { statusCode: 403 },
    );
    expect(await prisma.modelPricing.count()).toBe(1);
    expect(Number((await prisma.modelPricing.findUniqueOrThrow({ where: { id: row.id } })).inputPrice)).toBe(7);
  });
  it("rolls back every row after a late decision changes to Deny", async () => {
    await group();
    const a = await create("a"),
      b = await create("b"),
      iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    let calls = 0;
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      if (input.action === "quyan:model_pricing:ImportPricing" && ++calls >= 3)
        return input.resources.map(() => ({
          decision: "ExplicitDeny" as const,
          reason: "explicit-deny" as const,
          matchedStatements: [],
        }));
      return original(input);
    });
    await expect(
      service.importManagedModelPricing([model("a"), model("b"), model("new")], actor, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    const rows = await prisma.modelPricing.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(rows.every((row) => Number(row.inputPrice) === 1.25)).toBe(true);
    expect(await prisma.modelPricing.count()).toBe(2);
  });
  it("rejects group revocation before the import transaction", async () => {
    const global = await group(),
      original = repo.importModels.bind(repo);
    vi.spyOn(repo, "importModels").mockImplementation(async (input, targets, guard) => {
      await prisma.group.update({ where: { id: global.id }, data: { permissions: [] } });
      return original(input, targets, guard);
    });
    await expect(service.importManagedModelPricing([model("new")], actor, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await prisma.modelPricing.count()).toBe(0);
  });
  it("cannot import without real platform eligibility", async () => {
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(service.importManagedModelPricing([model("new")], actor, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await prisma.modelPricing.count()).toBe(0);
  });
  it("rolls back earlier items if a later item's merged pricing mode is invalid", async () => {
    await group();
    const a = await create("a");
    await expect(
      service.importManagedModelPricing(
        [model("a"), { ...model("invalid"), pricingType: "per-request" }],
        actor,
        request(),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await prisma.modelPricing.count()).toBe(1);
    expect(Number((await prisma.modelPricing.findUniqueOrThrow({ where: { id: a.id } })).inputPrice)).toBe(1.25);
  });
  it("requires explicit role grants covering the entire imported set", async () => {
    await group();
    const row = await create("a"),
      role = await prisma.ramRole.create({
        data: { accountOwnerId: owner, name: "model-pricing-import-" + randomUUID() },
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
    await bind(
      {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "quyan:model_pricing:ImportPricing",
          Resource: [platformModelPricingCollectionArn(), platformModelPricingArn(row.id)],
        },
      },
      "role",
      role.id,
    );
    expect(await service.importManagedModelPricing([model("a")], actor, req)).toEqual({
      created: 0,
      updated: 1,
      total: 1,
    });
    await expect(service.importManagedModelPricing([model("new")], actor, req)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await prisma.modelPricing.count()).toBe(1);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.importManagedModelPricing([model("a")], actor, req)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("keeps shadow preparation read-only and calls the legacy bulk write exactly once", async () => {
    await group();
    env.security.iamAuthorizationMode = "shadow";
    await create("a");
    await bind({
      Version: "1",
      Statement: { Effect: "Deny", Action: "quyan:model_pricing:ImportPricing", Resource: "*" },
    });
    const native = vi.spyOn(repo, "importModels"),
      legacy = vi.spyOn(ModelPricingRepository.getInstance(), "importModels");
    expect(await service.importManagedModelPricing([model("a"), model("new")], actor, request())).toEqual({
      created: 1,
      updated: 1,
      total: 2,
    });
    expect(native).not.toHaveBeenCalled();
    expect(legacy).toHaveBeenCalledOnce();
    expect(await prisma.modelPricing.count()).toBe(2);
  });
});
