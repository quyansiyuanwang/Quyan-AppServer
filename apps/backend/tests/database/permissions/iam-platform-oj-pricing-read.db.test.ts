import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { OJPricingService } from "@/services/oj-submitter/oj-pricing.service";
import { PlatformOjPricingReadRepository } from "@/store/oj-submitter/platform-oj-pricing-read.repository";
import { OJModelPricingRepository } from "@/store/oj-submitter/oj-model-pricing.repository";
import { platformOjPricingArn } from "@/iam/resources/platform-oj-pricing-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string;
const originalMode = env.security.iamAuthorizationMode,
  service = OJPricingService.getInstance(),
  repo = PlatformOjPricingReadRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "pricing-read-" + randomUUID(),
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
  prisma.oJModelPricing.create({
    data: { model, inputPrice: 1.25, outputPrice: 2.5, multiplier: 1.5, provider: "fixture provider" },
  });
async function group() {
  const row = await prisma.group.create({
    data: {
      username: "pricing-read-" + randomUUID(),
      name: "fixture global",
      level: 0,
      accountOwnerId: null,
      permissions: [Permission.OJ_PRICING_READ],
    },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: row.id } });
  return row;
}
async function bind(document: unknown, principalType = "user", principalId = actor) {
  const parsed = parseIamPolicy(document);
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "pricing-read-" + randomUUID(),
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
describe("platform OJ pricing resource read authorization database", () => {
  it("filters actual price resources before hydration and preserves decimal values", async () => {
    await group();
    const denied = await create("provider/hidden"),
      visible = await create("provider/visible");
    await bind({
      Version: "1",
      Statement: { Effect: "Deny", Action: "quyan:oj:ListPricing", Resource: platformOjPricingArn(denied.id) },
    });
    const hydrate = vi.spyOn(repo, "hydrate");
    expect(await service.listManagedPricing(request())).toEqual([
      expect.objectContaining({ id: visible.id, inputPrice: 1.25, outputPrice: 2.5, multiplier: 1.5 }),
    ]);
    expect(hydrate.mock.calls.flatMap((c) => c[1].map((t) => t.id))).not.toContain(denied.id);
  });
  it("uses model names only as lookups and rejects missing or denied details", async () => {
    await group();
    const row = await create("provider/model:v1");
    expect(await service.getManagedPricing(row.model, request())).toMatchObject({
      id: row.id,
      model: row.model,
      inputPrice: 1.25,
    });
    await bind({
      Version: "1",
      Statement: { Effect: "Deny", Action: "quyan:oj:GetPricing", Resource: platformOjPricingArn(row.id) },
    });
    const hydrate = vi.spyOn(repo, "hydrate");
    await expect(service.getManagedPricing(row.model, request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.getManagedPricing("provider/missing", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("cannot manufacture platform eligibility through ownership or account policies", async () => {
    await create("fixture");
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(service.listManagedPricing(request())).rejects.toMatchObject({ statusCode: 403 });
    const root = request();
    root.user!.userId = owner;
    root.authContext!.principalUserId = owner;
    await expect(service.listManagedPricing(root)).rejects.toMatchObject({ statusCode: 403 });
    const global = await group();
    await prisma.group.update({ where: { id: global.id }, data: { accountOwnerId: owner } });
    await expect(service.getManagedPricing("fixture", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("discards prices changed between metadata and hydration", async () => {
    await group();
    const row = await create("fixture"),
      original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (principal, targets) => {
      await prisma.oJModelPricing.update({
        where: { id: row.id },
        data: { inputPrice: 99, updateTime: new Date(Date.now() + 1000) },
      });
      return original(principal, targets);
    });
    await expect(service.getManagedPricing("fixture", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks group eligibility and new Deny before returning hydrated prices", async () => {
    const global = await group(),
      row = await create("fixture"),
      original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (principal, targets) => {
      const data = await original(principal, targets);
      await prisma.group.update({ where: { id: global.id }, data: { permissions: [] } });
      return data;
    });
    await expect(service.listManagedPricing(request())).rejects.toMatchObject({ statusCode: 403 });
    vi.restoreAllMocks();
    await prisma.group.update({ where: { id: global.id }, data: { permissions: [Permission.OJ_PRICING_READ] } });
    vi.spyOn(repo, "hydrate").mockImplementation(async (principal, targets) => {
      const data = await original(principal, targets);
      await bind({
        Version: "1",
        Statement: { Effect: "Deny", Action: "quyan:oj:GetPricing", Resource: platformOjPricingArn(row.id) },
      });
      return data;
    });
    await expect(service.getManagedPricing("fixture", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("restricts AssumeRole to explicit price grants and refuses revoked sessions", async () => {
    await group();
    const row = await create("fixture"),
      other = await create("other");
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "pricing-read-" + randomUUID() } });
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
    expect(await service.listManagedPricing(req)).toEqual([]);
    await bind(
      {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: ["quyan:oj:ListPricing", "quyan:oj:GetPricing"],
          Resource: platformOjPricingArn(row.id),
        },
      },
      "role",
      role.id,
    );
    expect((await service.listManagedPricing(req)).map((r) => r.id)).toEqual([row.id]);
    await expect(service.getManagedPricing(other.model, req)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.getManagedPricing(row.model, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("preserves the old display read once in %s", async (mode) => {
    await group();
    const row = await create("fixture");
    env.security.iamAuthorizationMode = mode;
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: ["quyan:oj:ListPricing", "quyan:oj:GetPricing"],
        Resource: platformOjPricingArn(row.id),
      },
    });
    const display = vi.spyOn(OJModelPricingRepository.getInstance(), "listActive");
    expect((await service.listManagedPricing(request())).map((r) => r.id)).toEqual([row.id]);
    expect(display).toHaveBeenCalledOnce();
    expect(await service.getManagedPricing(row.model, request())).toMatchObject({ id: row.id, inputPrice: 1.25 });
  });
  it("retains internal billing reads independently of management IAM", async () => {
    const row = await create("fixture");
    expect(await service.getPricing(row.model)).toMatchObject({ id: row.id, inputPrice: 1.25 });
  });
});
