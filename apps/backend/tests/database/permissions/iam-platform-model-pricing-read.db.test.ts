import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { ModelPricingService } from "@/services/relay/model-pricing.service";
import { PlatformModelPricingReadRepository } from "@/store/relay/platform-model-pricing-read.repository";
import { ModelPricingRepository } from "@/store/relay/model-pricing.repository";
import { platformModelPricingArn } from "@/iam/resources/platform-model-pricing-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string;
const originalMode = env.security.iamAuthorizationMode,
  service = ModelPricingService.getInstance(),
  repo = PlatformModelPricingReadRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "model-pricing-export-" + randomUUID(),
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
  }) as unknown as TypedRequest;
const create = (model: string) =>
  prisma.modelPricing.create({
    data: { model, inputPrice: 1.25, outputPrice: 2.5, pricingType: "token-based", provider: "fixture provider" },
  });
async function group() {
  const row = await prisma.group.create({
    data: {
      username: "model-pricing-export-" + randomUUID(),
      name: "fixture global",
      level: 0,
      accountOwnerId: null,
      permissions: [Permission.MODEL_PRICING_READ],
    },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: row.id } });
  return row;
}
async function bind(document: unknown, principalType = "user", principalId = actor) {
  const parsed = parseIamPolicy(document);
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "model-pricing-export-" + randomUUID(),
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
describe("platform model pricing export database", () => {
  it("exports only authorized actual records ordered by model", async () => {
    await group();
    const row = await create("a/model"),
      denied = await create("b/model");
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:model_pricing:ExportModels",
        Resource: platformModelPricingArn(denied.id),
      },
    });
    const hydrate = vi.spyOn(repo, "hydrate");
    expect(await service.exportManagedModelPricing(request())).toEqual([
      expect.objectContaining({ id: row.id, model: row.model, inputPrice: 1.25 }),
    ]);
    expect(hydrate.mock.calls.flatMap((c) => c[1].map((t) => t.id))).not.toContain(denied.id);
  });
  it("cannot manufacture export eligibility through account ownership or Allow wildcard", async () => {
    await create("fixture");
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(service.exportManagedModelPricing(request())).rejects.toMatchObject({ statusCode: 403 });
    const root = request();
    root.user!.userId = owner;
    root.authContext!.principalUserId = owner;
    await expect(service.exportManagedModelPricing(root)).rejects.toMatchObject({ statusCode: 403 });
    const global = await group();
    await prisma.group.update({ where: { id: global.id }, data: { accountOwnerId: owner } });
    await expect(service.exportManagedModelPricing(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects changed prices between metadata and hydration", async () => {
    await group();
    const row = await create("fixture"),
      original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (principal, targets) => {
      await prisma.modelPricing.update({
        where: { id: row.id },
        data: { inputPrice: 99, updateTime: new Date(Date.now() + 1000) },
      });
      return original(principal, targets);
    });
    await expect(service.exportManagedModelPricing(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks global eligibility after reading prices", async () => {
    const global = await group();
    await create("fixture");
    const original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (principal, targets) => {
      const rows = await original(principal, targets);
      await prisma.group.update({ where: { id: global.id }, data: { permissions: [] } });
      return rows;
    });
    await expect(service.exportManagedModelPricing(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("applies a newly attached Deny before returning the export", async () => {
    await group();
    const row = await create("fixture"),
      original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (principal, targets) => {
      const rows = await original(principal, targets);
      await bind({
        Version: "1",
        Statement: {
          Effect: "Deny",
          Action: "quyan:model_pricing:ExportModels",
          Resource: platformModelPricingArn(row.id),
        },
      });
      return rows;
    });
    await expect(service.exportManagedModelPricing(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("limits AssumeRole to explicit record grants and rejects revoked sessions", async () => {
    await group();
    const row = await create("fixture");
    await create("other");
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "model-pricing-export-" + randomUUID() },
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
    expect(await service.exportManagedModelPricing(req)).toEqual([]);
    await bind(
      {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "quyan:model_pricing:ExportModels",
          Resource: platformModelPricingArn(row.id),
        },
      },
      "role",
      role.id,
    );
    expect((await service.exportManagedModelPricing(req)).map((r) => r.id)).toEqual([row.id]);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.exportManagedModelPricing(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("preserves the old display read once in %s", async (mode) => {
    await group();
    const row = await create("fixture");
    env.security.iamAuthorizationMode = mode;
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:model_pricing:ExportModels",
        Resource: platformModelPricingArn(row.id),
      },
    });
    const display = vi.spyOn(ModelPricingRepository.getInstance(), "listActiveOrderedByModel");
    expect((await service.exportManagedModelPricing(request())).map((r) => r.id)).toEqual([row.id]);
    expect(display).toHaveBeenCalledOnce();
  });
  it("retains public pricing reads independently of export IAM", async () => {
    const row = await create("fixture");
    expect(await service.getModelPricing()).toEqual([expect.objectContaining({ id: row.id, inputPrice: 1.25 })]);
  });
});
