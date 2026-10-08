import { AsyncResource } from "node:async_hooks";
import { setRequestContext } from "@/util/request-context";
import { RamAuthorizationRepository } from "@/store/users/ram-authorization.repository";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { iamAuthorizationScopeKey } from "@/iam/authorization-scope";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import type { IamPrincipal } from "@quyan/shared";
const service = RamService.getInstance(),
  iam = IamAuthorizationService.getInstance();
const oldMode = env.security.iamAuthorizationMode;
let owner: string, child: string, second: string, foreign: string;
const arn = (id: string, account = owner) => "acs:quyan:*:" + account + ":user/" + id;
const principal = (): IamPrincipal => ({
  subjectUserId: child,
  principalUserId: child,
  accountOwnerId: owner,
  subjectType: "sub_user",
});
const decision = async (id: string) =>
  (await iam.authorize({ principal: principal(), action: "quyan:ram:ReadUser", resource: arn(id) })).decision;
const policy = (effect: "Allow" | "Deny" = "Allow") =>
  service.createPolicy(owner, {
    name: "fixture-" + randomUUID(),
    document: { Version: "1", Statement: { Effect: effect, Action: "quyan:ram:ReadUser", Resource: "*" } },
  });
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const user = (accountOwnerId?: string) =>
    prisma.user.create({
      data: {
        username: "auth-fixture-" + randomUUID(),
        password: "test-fixture-only",
        userType: accountOwnerId ? "ram_user" : "root",
        accountOwnerId,
        parentUserId: accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
  owner = (await user()).id;
  child = (await user(owner)).id;
  second = (await user(owner)).id;
  foreign = (await user()).id;
});
afterEach(() => {
  env.security.iamAuthorizationMode = oldMode;
});
describe("independent authorization scope", () => {
  it("intersects resource scope with a broad policy and never projects scoped grants into legacy attachments", async () => {
    const grant = await policy();
    const auth = await service.createAuthorization(owner, {
      principalType: "user",
      principalId: child,
      policyId: grant.id,
      scopeType: "resource",
      scopeArn: arn(child),
    });
    expect(await decision(child)).toBe("Allow");
    expect(await decision(second)).toBe("ImplicitDeny");
    expect(await prisma.ramPolicyAttachment.count({ where: { policyId: grant.id } })).toBe(0);
    const result = await iam.authorize({ principal: principal(), action: "quyan:ram:ReadUser", resource: arn(child) });
    expect(result.matchedStatements).toContainEqual(expect.objectContaining({ authorizationId: auth.id }));
    await service.deleteAuthorization(owner, auth.id);
    expect(await decision(child)).toBe("ImplicitDeny");
  });
  it("keeps multiple scopes for one policy and applies an explicit scoped Deny", async () => {
    const grant = await policy();
    for (const id of [child, second])
      await service.createAuthorization(owner, {
        principalType: "user",
        principalId: child,
        policyId: grant.id,
        scopeType: "resource",
        scopeArn: arn(id),
      });
    expect(await decision(child)).toBe("Allow");
    expect(await decision(second)).toBe("Allow");
    const deny = await policy("Deny");
    await service.createAuthorization(owner, {
      principalType: "user",
      principalId: child,
      policyId: deny.id,
      scopeType: "resource",
      scopeArn: arn(second),
    });
    expect(await decision(child)).toBe("Allow");
    expect(await decision(second)).toBe("ExplicitDeny");
  });
  it("creates an idempotent account authorization and removes its legacy projection atomically", async () => {
    const grant = await policy();
    const input = {
      principalType: "user" as const,
      principalId: child,
      policyId: grant.id,
      scopeType: "account" as const,
    };
    const first = await service.createAuthorization(owner, input);
    const second = await service.createAuthorization(owner, input);
    expect(first.id).toBe(second.id);
    expect(await prisma.ramPolicyAttachment.count({ where: { policyId: grant.id } })).toBe(1);
    expect(await decision(child)).toBe("Allow");
    await service.deleteAuthorization(owner, first.id);
    expect(await prisma.ramPolicyAttachment.count({ where: { policyId: grant.id } })).toBe(0);
    expect(await decision(child)).toBe("ImplicitDeny");
    await service.attachPolicy(owner, { policyId: grant.id, targetType: "user", targetId: child });
    expect((await service.listAuthorizations(owner)).filter((row) => row.policyId === grant.id)).toHaveLength(1);
    await service.detachPolicy(owner, { policyId: grant.id, targetType: "user", targetId: child });
    expect(await decision(child)).toBe("ImplicitDeny");
  });
  it("rejects cross-account principals and scopes, and protects root recovery relations", async () => {
    const grant = await policy();
    for (const input of [
      { principalType: "user" as const, principalId: foreign, policyId: grant.id, scopeType: "account" as const },
      {
        principalType: "user" as const,
        principalId: child,
        policyId: grant.id,
        scopeType: "resource" as const,
        scopeArn: arn(foreign, foreign),
      },
    ])
      await expect(service.createAuthorization(owner, input)).rejects.toThrow();
    const recovery = await service.createAuthorization(owner, {
      principalType: "user",
      principalId: owner,
      policyId: grant.id,
      scopeType: "account",
    });
    await expect(service.deleteAuthorization(child, recovery.id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.deleteAuthorization(foreign, recovery.id)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.ramAuthorization.count({ where: { id: recovery.id, status: 1 } })).toBe(1);
  });
});
describe("resource group evaluation and delegation", () => {
  it("changes authorization immediately when a member is removed or restored", async () => {
    const group = await service.createResourceGroup(owner, { name: "fixture-group" });
    const full = await service.addResourceGroupMember(owner, group.id, { resourceArn: arn(child) });
    const grant = await policy();
    await service.createAuthorization(owner, {
      principalType: "user",
      principalId: child,
      policyId: grant.id,
      scopeType: "resource-group",
      scopeResourceId: group.id,
    });
    expect(await decision(child)).toBe("Allow");
    expect(await decision(second)).toBe("ImplicitDeny");
    await service.removeResourceGroupMember(owner, group.id, full.members[0].id);
    expect(await decision(child)).toBe("ImplicitDeny");
    await service.addResourceGroupMember(owner, group.id, { resourceArn: arn(child) });
    expect(await decision(child)).toBe("Allow");
    expect((await service.listResourceGroups(owner))[0].members).toHaveLength(1);
  });
  it("rejects invented ownership, unknown targets, wildcard members and foreign groups", async () => {
    const group = await service.createResourceGroup(owner, { name: "fixture-group" });
    for (const resourceArn of [arn(foreign), arn("nonexistent"), "*", "acs:quyan:*:" + owner + ":user/*"])
      await expect(service.addResourceGroupMember(owner, group.id, { resourceArn })).rejects.toMatchObject({
        statusCode: 400,
      });
    await expect(
      service.addResourceGroupMember(foreign, group.id, { resourceArn: arn(foreign, foreign) }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await service.listResourceGroups(owner))[0].members).toHaveLength(0);
  });
  it("does not let a member-scoped grant be delegated outside the group or expanded by its beneficiary", async () => {
    const group = await service.createResourceGroup(owner, { name: "fixture-group" });
    await service.addResourceGroupMember(owner, group.id, { resourceArn: arn(child) });
    const grant = await policy();
    await service.createAuthorization(owner, {
      principalType: "user",
      principalId: child,
      policyId: grant.id,
      scopeType: "resource-group",
      scopeResourceId: group.id,
    });
    const target = {
      Version: "1" as const,
      Statement: { Effect: "Allow" as const, Action: "quyan:ram:ReadUser", Resource: arn(second) },
    };
    expect((await service.checkPolicyDelegation(child, target)).allowed).toBe(false);
    await expect(service.addResourceGroupMember(child, group.id, { resourceArn: arn(second) })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await decision(second)).toBe("ImplicitDeny");
    expect((await service.listResourceGroups(owner))[0].members).toHaveLength(1);
  });
});

describe("authorization integrity and concurrency boundaries", () => {
  it("checks direct service input and reports duplicate resource-group names safely", async () => {
    const grant = await policy();
    await expect(
      service.createAuthorization(owner, {
        principalType: "root",
        principalId: child,
        policyId: grant.id,
        scopeType: "account",
      } as never),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      service.createAuthorization(owner, {
        principalType: "user",
        principalId: child,
        policyId: grant.id,
        scopeType: "invented",
        scopeArn: arn(child),
      } as never),
    ).rejects.toMatchObject({ statusCode: 400 });
    await service.createResourceGroup(owner, { name: "unique-group" });
    await expect(service.createResourceGroup(owner, { name: "unique-group" })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(await service.listResourceGroups(owner, { page: 2, pageSize: 1 })).toHaveLength(0);
  });
  it("rejects a stale default-version proof without creating an authorization or legacy projection", async () => {
    const grant = await policy();
    await expect(
      RamAuthorizationRepository.getInstance().create({
        accountOwnerId: owner,
        principalType: "user",
        principalId: child,
        policyId: grant.id,
        scopeType: "account",
        scopeKey: iamAuthorizationScopeKey("account"),
        createdBy: owner,
        expectedVersionId: "stale",
        expectedDocumentHash: grant.documentHash,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.ramAuthorization.count({ where: { policyId: grant.id } })).toBe(0);
    expect(await prisma.ramPolicyAttachment.count({ where: { policyId: grant.id } })).toBe(0);
  });
  it("serializes group membership admission against a concurrent scope binding", async () => {
    const group = await service.createResourceGroup(owner, { name: "revision-group" });
    const stale = await prisma.ramResourceGroup.findUniqueOrThrow({ where: { id: group.id } });
    const grant = await policy();
    await service.createAuthorization(owner, {
      principalType: "user",
      principalId: child,
      policyId: grant.id,
      scopeType: "resource-group",
      scopeResourceId: group.id,
    });
    await expect(
      RamResourceGroupRepository.getInstance().addMember({
        accountOwnerId: owner,
        resourceGroupId: group.id,
        resourceArn: arn(second),
        service: "quyan",
        resourceType: "user",
        resourceId: second,
        expectedGroupUpdateTime: stale.updateTime,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.ramResourceGroupMember.count({ where: { resourceGroupId: group.id } })).toBe(0);
  });
  it("stops granting access when a member no longer exists in the account", async () => {
    const group = await service.createResourceGroup(owner, { name: "live-member-group" });
    await service.addResourceGroupMember(owner, group.id, { resourceArn: arn(second) });
    const grant = await policy();
    await service.createAuthorization(owner, {
      principalType: "user",
      principalId: child,
      policyId: grant.id,
      scopeType: "resource-group",
      scopeResourceId: group.id,
    });
    expect(await decision(second)).toBe("Allow");
    await prisma.user.update({ where: { id: second }, data: { status: 0 } });
    expect(await decision(second)).toBe("ImplicitDeny");
  });
  it("proves the effective scoped grant instead of requiring ownership of the whole policy", async () => {
    const grant = await policy();
    await service.createAuthorization(owner, {
      principalType: "user",
      principalId: child,
      policyId: grant.id,
      scopeType: "resource",
      scopeArn: arn(child),
    });
    await service.createAuthorization(child, {
      principalType: "user",
      principalId: second,
      policyId: grant.id,
      scopeType: "resource",
      scopeArn: arn(child),
    });
    await expect(
      service.createAuthorization(child, {
        principalType: "user",
        principalId: second,
        policyId: grant.id,
        scopeType: "resource",
        scopeArn: arn(second),
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("HTTP-context IAM list filtering", () => {
  it("filters denied authorization rows after account-scoped database pagination", async () => {
    const grant = await policy();
    const hidden = await service.createAuthorization(owner, {
      principalType: "user",
      principalId: second,
      policyId: grant.id,
      scopeType: "account",
    });
    const visible = await service.createPolicy(owner, {
      name: "list-" + randomUUID(),
      document: {
        Version: "1",
        Statement: [
          { Effect: "Allow", Action: "quyan:ram:ListAuthorizations", Resource: "*" },
          {
            Effect: "Deny",
            Action: "quyan:ram:ListAuthorizations",
            Resource: "acs:quyan:*:" + owner + ":authorization/" + hidden.id,
          },
        ],
      },
    });
    await service.createAuthorization(owner, {
      principalType: "user",
      principalId: child,
      policyId: visible.id,
      scopeType: "account",
    });
    const rows = await new AsyncResource("iam-list-test").runInAsyncScope(async () => {
      setRequestContext({
        user: { userId: child },
        authContext: { principalUserId: child, accountOwnerId: owner, subjectType: "sub_user" },
        headers: {},
        secure: true,
      } as never);
      return service.listAuthorizations(child);
    });
    expect(rows).toHaveLength(1);
    expect(rows.map((row) => row.id)).not.toContain(hidden.id);
  });
});
