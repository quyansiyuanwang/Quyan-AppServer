import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { MonthlyPassService } from "@/services/billing/monthly-pass.service";
import { MonthlyPassFilterOptionsRepository } from "@/store/billing/monthly-pass-filter-options.repository";
import { MONTHLY_PASS_FILTER_KINDS } from "@/store/billing/monthly-pass-filter-options.store";
import { monthlyPassFilterResource } from "@/services/billing/monthly-pass-filter-options-iam.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  service = MonthlyPassService.getInstance(),
  repository = MonthlyPassFilterOptionsRepository.getInstance();
let owner: string,
  actor: string,
  groupId: string,
  templateId: string,
  modelId: string,
  channelId: string,
  modelName: string;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "ignored:*" },
    ip: "192.0.2.50",
    secure: true,
  }) as unknown as TypedRequest;
const options = () => service.getFilterOptions(actor, request());
async function deny(resource: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: "Deny", Action: "quyan:monthly_pass:GetFilterOptions", Resource: resource },
  });
  const p = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "filter-deny-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      policyId: p.id,
      principalType: "user",
      principalId: actor,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "filter-user-" + randomUUID(),
          password: "fixture-only",
          permissionAdds: [],
          permissionRemoves: [],
          accountOwnerId,
          parentUserId: accountOwnerId,
          userType: accountOwnerId ? "ram_user" : "root",
        },
      })
    ).id;
  owner = await user();
  actor = await user(owner);
  groupId = (
    await prisma.group.create({
      data: {
        username: "filter-group-" + randomUUID(),
        name: "option fixture group",
        permissions: [Permission.MONTHLY_PASS_USAGE_READ],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  templateId = (
    await prisma.monthlyPassTemplate.create({
      data: { name: "filter-template-" + randomUUID(), defaultQuota: 100, status: 0 },
    })
  ).id;
  modelName = "filter-model-" + randomUUID();
  modelId = (await prisma.modelPricing.create({ data: { model: modelName, inputPrice: 1, outputPrice: 2 } })).id;
  channelId = (
    await prisma.relayChannel.create({
      data: {
        name: "filter-channel-" + randomUUID(),
        visibilityMode: "public",
        openaiUpstreamApiKey: "fixture-secret-must-not-appear",
      },
    })
  ).id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  await prisma.monthlyPassTemplate.deleteMany({ where: { id: templateId } });
  await prisma.relayChannel.deleteMany({ where: { id: channelId } });
  await prisma.modelPricing.deleteMany({ where: { id: modelId } });
});
describe("resource-filtered monthly pass options", () => {
  it("returns allowed option fields with only one of the prior reader permissions", async () => {
    const result = await options();
    expect(result.templates).toEqual(expect.arrayContaining([expect.objectContaining({ id: templateId, status: 0 })]));
    expect(result.models).toContain(modelName);
    expect(result.channels).toEqual(expect.arrayContaining([expect.objectContaining({ value: channelId })]));
    expect(result.groups).toEqual(expect.arrayContaining([expect.objectContaining({ id: groupId })]));
    expect(JSON.stringify(result)).not.toContain("fixture-secret-must-not-appear");
  });
  it.each(MONTHLY_PASS_FILTER_KINDS)("omits a denied %s while keeping other authorized categories", async (kind) => {
    const id = { template: templateId, model: modelId, channel: channelId, group: groupId }[kind];
    await deny(monthlyPassFilterResource(kind, id));
    const result = await options();
    if (kind === "template") expect(result.templates.some((row) => row.id === id)).toBe(false);
    if (kind === "model") expect(result.models).not.toContain(modelName);
    if (kind === "channel") expect(result.channels.some((row) => row.value === id)).toBe(false);
    if (kind === "group") expect(result.groups.some((row) => row.id === id)).toBe(false);
  });
  it("requires existing channel visibility even with IAM Allow", async () => {
    await prisma.relayChannel.update({ where: { id: channelId }, data: { visibilityMode: "private" } });
    expect((await options()).channels.some((row) => row.value === channelId)).toBe(false);
    await prisma.relayChannel.update({
      where: { id: channelId },
      data: { visibilityMode: "whitelist", visibilityConfig: { userIds: [actor] } },
    });
    expect((await options()).channels.some((row) => row.value === channelId)).toBe(true);
    await prisma.relayChannel.update({ where: { id: channelId }, data: { visibilityMode: "hidden" } });
    expect((await options()).channels.some((row) => row.value === channelId)).toBe(false);
  });
  it("does not reveal another account group or a more privileged group", async () => {
    const other = (
      await prisma.group.create({
        data: { username: "filter-private-" + randomUUID(), accountOwnerId: owner, permissions: [], level: 5 },
      })
    ).id;
    const higher = (
      await prisma.group.create({ data: { username: "filter-higher-" + randomUUID(), permissions: [], level: 0 } })
    ).id;
    expect((await options()).groups.some((row) => [other, higher].includes(row.id))).toBe(false);
  });
  it("detects an earlier category changed while a later category is hydrated, even with its timestamp preserved", async () => {
    const original = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (kind, scope, targets) => {
      const result = await original(kind, scope, targets);
      if (kind === "model") {
        const template = await prisma.monthlyPassTemplate.findUniqueOrThrow({ where: { id: templateId } });
        await prisma.monthlyPassTemplate.update({
          where: { id: templateId },
          data: { name: template.name + "-changed", updateTime: template.updateTime },
        });
      }
      return result;
    });
    await expect(options()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects policy revocation during option collection", async () => {
    const original = repository.hydrate.bind(repository);
    let revoked = false;
    vi.spyOn(repository, "hydrate").mockImplementation(async (kind, scope, targets) => {
      const result = await original(kind, scope, targets);
      if (kind === "template" && !revoked) {
        revoked = true;
        await deny(monthlyPassFilterResource("template", templateId));
      }
      return result;
    });
    await expect(options()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("retains the platform management ceiling for JSON policies", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await expect(options()).rejects.toMatchObject({ statusCode: 403 });
  });
});
