import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { PlatformTerminalEntitlementAssignIamService } from "@/services/remote-terminal/platform-terminal-entitlement-assign-iam.service";
import { PlatformTerminalEntitlementAssignRepository } from "@/store/remote-terminal-product/platform-terminal-entitlement-assign.repository";
import { RemoteTerminalProductService } from "@/services/remote-terminal/remote-terminal-product.service";
import { RemoteTerminalProductRepository } from "@/store/remote-terminal-product/remote-terminal-product.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { platformTemplateArn } from "@/iam/resources/platform-template-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  repository = PlatformTerminalEntitlementAssignRepository.getInstance(),
  authority = PlatformTerminalEntitlementAssignIamService.getInstance();
let owner: string, actor: string, customer: string, groupId: string, template: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "terminal-assign-" + randomUUID(),
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
    headers: {},
    secure: true,
    ip: "192.0.2.42",
  }) as unknown as TypedRequest;
const body = () => ({
  userId: customer,
  templateId: template,
  startAt: "2026-01-01",
  endAt: "2027-01-01",
  deviceLimit: 2,
  terminalLimit: 1,
});
const data = () => ({
  userId: customer,
  templateId: template,
  name: "fixture entitlement",
  startAt: new Date("2026-01-01"),
  endAt: new Date("2027-01-01"),
  deviceLimit: 2,
  terminalLimit: 1,
  status: 1,
  assignedBy: actor,
  purchaseAmount: 0,
});
const prepared = () => authority.prepare(actor, request(), customer, template);
async function deny(resource: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: "Deny", Action: "quyan:remote_terminal:AssignEntitlement", Resource: resource },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "assign-deny-" + randomUUID(),
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
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  customer = await user();
  groupId = (
    await prisma.group.create({
      data: {
        username: "terminal-assign-" + randomUUID(),
        name: "Fixture manager",
        accountOwnerId: null,
        permissions: [Permission.REMOTE_TERMINAL_ASSIGNMENT_WRITE],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  template = (
    await prisma.remoteTerminalProductTemplate.create({
      data: {
        name: "fixture-template-" + randomUUID(),
        devicePrice: 1,
        terminalPrice: 2,
        purchaseLimitPerUser: 1,
        purchaseLimitWindowDays: 30,
      },
    })
  ).id;
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
});
describe("terminal entitlement resource assignment", () => {
  it("creates an uncharged entitlement without issuing credentials or exposing related resources", async () => {
    const hydration = vi.spyOn(RemoteTerminalProductRepository.getInstance(), "createEntitlement"),
      token = vi.spyOn(RemoteTerminalProductRepository.getInstance(), "upsertEntitlementToken");
    const result = await RemoteTerminalProductService.getInstance().assignEntitlement(body(), actor, request());
    expect(result).toMatchObject({ userId: customer, templateId: template, purchaseAmount: 0 });
    expect(result.registrationToken).toBeUndefined();
    expect(result.username).toBeUndefined();
    expect(hydration).not.toHaveBeenCalled();
    expect(token).not.toHaveBeenCalled();
    expect(await prisma.remoteTerminalEntitlementToken.findUnique({ where: { entitlementId: result.id } })).toBeNull();
  });
  it.each(["user", "template", "new entitlement"])(
    "rejects %s denial without persisting any entitlement",
    async (kind) => {
      const resource =
        kind === "user"
          ? platformUserArn(customer)
          : kind === "template"
            ? platformTemplateArn("remote-terminal", template)
            : "acs:platform:*:platform:remote-terminal-entitlement/" + customer + "/*";
      await deny(resource);
      await expect(
        RemoteTerminalProductService.getInstance().assignEntitlement(body(), actor, request()),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(await prisma.remoteTerminalUserEntitlement.count({ where: { userId: customer } })).toBe(0);
    },
  );
  it.each(["customer", "template"])("refuses changed %s data after authorization", async (kind) => {
    const source = (await prepared())!;
    if (kind === "customer") await prisma.$executeRaw`UPDATE users SET accountOwnerId=${owner} WHERE id=${customer}`;
    else await prisma.$executeRaw`UPDATE remote_terminal_product_templates SET devicePrice=3 WHERE id=${template}`;
    await expect(repository.create(data(), source.guard)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.remoteTerminalUserEntitlement.count({ where: { userId: customer } })).toBe(0);
  });
  it("enforces purchase limits inside the creation boundary", async () => {
    const first = (await prepared())!,
      second = (await prepared())!;
    await repository.create(data(), first.guard);
    await expect(repository.create(data(), second.guard)).rejects.toMatchObject({ statusCode: 400 });
    expect(
      await prisma.remoteTerminalUserEntitlement.count({ where: { userId: customer, templateId: template } }),
    ).toBe(1);
  });
  it("serializes concurrent assignment of the final available purchase slot", async () => {
    const first = (await prepared())!,
      second = (await prepared())!;
    const results = await Promise.allSettled([
      repository.create(data(), first.guard),
      repository.create(data(), second.guard),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      await prisma.remoteTerminalUserEntitlement.count({ where: { userId: customer, templateId: template } }),
    ).toBe(1);
  });
  it("rolls back creation when final generated-resource authorization fails", async () => {
    const source = (await prepared())!;
    source.guard.recheckEntry = async () => {
      throw iamAccountDenied();
    };
    await expect(repository.create(data(), source.guard)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.remoteTerminalUserEntitlement.count({ where: { userId: customer } })).toBe(0);
  });
  it("refuses guard reuse for another actor, user or template", async () => {
    const source = (await prepared())!;
    for (const patch of [{ userId: owner }, { assignedBy: owner }, { templateId: null }, { id: "chosen-by-client" }])
      await expect(repository.create({ ...data(), ...patch }, source.guard)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires the persisted global management ceiling", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await expect(prepared()).rejects.toMatchObject({ statusCode: 403 });
  });
});
