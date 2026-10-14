import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { PlatformTerminalTemplateWriteIamService } from "@/services/remote-terminal/platform-terminal-template-write-iam.service";
import { PlatformTerminalTemplateWriteRepository } from "@/store/remote-terminal-product/platform-terminal-template-write.repository";
import { RemoteTerminalProductService } from "@/services/remote-terminal/remote-terminal-product.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformTemplateArn } from "@/iam/resources/platform-template-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  repository = PlatformTerminalTemplateWriteRepository.getInstance(),
  authority = PlatformTerminalTemplateWriteIamService.getInstance();
let owner: string, actor: string, groupId: string, template: string, prefix: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "template-write-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        parentUserId: accountOwnerId,
        userType: accountOwnerId ? "ram_user" : "root",
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "client:Fake" },
    secure: true,
    ip: "192.0.2.42",
  }) as unknown as TypedRequest;
async function deny(action: string, resource: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: "Deny", Action: "quyan:remote_terminal:" + action, Resource: resource },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "write-deny-" + randomUUID(),
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
}
const prepared = () => authority.prepare("UpdateTemplate", actor, request(), template);
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  prefix = "template-write-" + randomUUID();
  owner = await user();
  actor = await user(owner);
  groupId = (
    await prisma.group.create({
      data: {
        username: prefix,
        name: "Fixture template manager",
        accountOwnerId: null,
        permissions: [Permission.REMOTE_TERMINAL_PRODUCT_WRITE],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  template = (
    await prisma.remoteTerminalProductTemplate.create({ data: { name: prefix, devicePrice: 1, terminalPrice: 2 } })
  ).id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.remoteTerminalProductTemplate.deleteMany({ where: { name: { startsWith: prefix } } });
  env.security.iamAuthorizationMode = mode;
});
describe("terminal template write transaction boundary", () => {
  it("updates, publishes, unpublishes and soft deletes through real native business methods", async () => {
    const service = RemoteTerminalProductService.getInstance();
    expect(
      (await service.updateTemplate(template, { description: "fixture edited", devicePrice: 3 }, actor, request()))
        .devicePrice,
    ).toBe(3);
    expect((await service.publishTemplate(template, actor, request())).publishStatus).toBe("published");
    expect((await service.unpublishTemplate(template, actor, request())).publishStatus).toBe("draft");
    await service.deleteTemplate(template, actor, request());
    expect(await prisma.remoteTerminalProductTemplate.findUnique({ where: { id: template } })).toMatchObject({
      status: -1,
      publishStatus: "draft",
      publishedAt: null,
    });
  });
  it("creates a real normalized template under collection and new-entry authority", async () => {
    const result = await RemoteTerminalProductService.getInstance().createTemplate(
      { name: prefix + "-created", devicePrice: 7, billingUnit: "week" },
      actor,
      request(),
    );
    expect(result.devicePrice).toBe(7);
    expect(result.deviceDailyPrice).toBe(1);
    expect(result.publishStatus).toBe("draft");
  });
  it.each(["UpdateTemplate", "PublishTemplate", "UnpublishTemplate", "DeleteTemplate"] as const)(
    "rejects explicit %s denial without touching source state",
    async (operation) => {
      await deny(operation, platformTemplateArn("remote-terminal", template));
      await expect(authority.prepare(operation, actor, request(), template)).rejects.toMatchObject({ statusCode: 403 });
      expect(await prisma.remoteTerminalProductTemplate.findUnique({ where: { id: template } })).toMatchObject({
        name: prefix,
        status: 1,
        publishStatus: "draft",
      });
    },
  );
  it("cannot soft-delete through update without DeleteTemplate authority", async () => {
    await deny("DeleteTemplate", platformTemplateArn("remote-terminal", template));
    await expect(
      RemoteTerminalProductService.getInstance().updateTemplate(template, { status: -1 }, actor, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.remoteTerminalProductTemplate.findUnique({ where: { id: template } }))?.status).toBe(1);
  });
  it("rolls back new entries when their resource is denied after the control grant", async () => {
    await deny("CreateTemplate", "acs:platform:*:platform:remote-terminal-template/*");
    await expect(
      RemoteTerminalProductService.getInstance().createTemplate(
        { name: prefix + "-denied", devicePrice: 1 },
        actor,
        request(),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.remoteTerminalProductTemplate.count({ where: { name: prefix + "-denied" } })).toBe(0);
  });
  it("refuses a stale full scalar snapshot even without an updateTime change", async () => {
    const source = await prepared();
    await prisma.$executeRaw`UPDATE remote_terminal_product_templates SET description='changed-without-timestamp' WHERE id=${template}`;
    await expect(
      repository.mutate(source!.target!, { description: "stale overwrite" }, source!.guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.remoteTerminalProductTemplate.findUnique({ where: { id: template } }))?.description).toBe(
      "changed-without-timestamp",
    );
  });
  it("refuses policy bindings changed between preparation and persistence", async () => {
    const source = await prepared();
    await deny("UpdateTemplate", platformTemplateArn("remote-terminal", template));
    await expect(
      repository.mutate(source!.target!, { description: "denied overwrite" }, source!.guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(
      (await prisma.remoteTerminalProductTemplate.findUnique({ where: { id: template } }))?.description,
    ).toBeNull();
  });
  it("refuses group eligibility changes even without timestamp changes", async () => {
    const source = await prepared();
    await prisma.$executeRaw`UPDATE \`groups\` SET permissions='[]' WHERE id=${groupId}`;
    await expect(repository.mutate(source!.target!, { description: "revoked" }, source!.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("rolls back changes if final resource admission fails after the write", async () => {
    const source = await prepared(),
      entry = source!.guard.recheckEntry;
    let checks = 0;
    source!.guard.recheckEntry = async (id) => {
      await entry(id);
      if (++checks === 2) throw iamAccountDenied();
    };
    await expect(
      repository.mutate(source!.target!, { description: "must roll back" }, source!.guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(checks).toBe(2);
    expect(
      (await prisma.remoteTerminalProductTemplate.findUnique({ where: { id: template } }))?.description,
    ).toBeNull();
  });
  it("refuses mutation through an account-owned group", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await expect(prepared()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("enforces duplicate names inside the write transaction", async () => {
    const source = await authority.prepare("CreateTemplate", actor, request());
    await expect(
      repository.create({ name: prefix, devicePrice: 1, status: 1, publishStatus: "draft" }, source!.guard),
    ).rejects.toMatchObject({ statusCode: 400, messageKey: "remoteTerminalProduct.templateNameExists" });
    expect(await prisma.remoteTerminalProductTemplate.count({ where: { name: prefix } })).toBe(1);
  });
  it("refuses malformed status and cannot reuse publication authority for unrelated writes", async () => {
    const source = await prepared();
    await expect(repository.mutate(source!.target!, { status: 2 }, source!.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
    const publish = await authority.prepare("PublishTemplate", actor, request(), template);
    await expect(
      repository.mutate(
        publish!.target!,
        { status: -1, publishStatus: "published", publishedAt: new Date() },
        publish!.guard,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.remoteTerminalProductTemplate.update({ where: { id: template }, data: { status: 2 } });
    await expect(prepared()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("cannot reuse update authority to bypass delete or publication checks", async () => {
    const source = await prepared();
    await expect(repository.mutate(source!.target!, { status: -1 }, source!.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      repository.mutate(source!.target!, { publishStatus: "published" }, source!.guard),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
