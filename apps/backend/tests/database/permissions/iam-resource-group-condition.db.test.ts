import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { IamPrincipal, IamPolicyDocument } from "@quyan/shared";
const ram = RamService.getInstance(),
  iam = IamAuthorizationService.getInstance(),
  groups = RamResourceGroupRepository.getInstance();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, target: string, foreign: string;
const arn = (id: string, account = owner) => `acs:quyan:*:${account}:user/${id}`;
const principal = (): IamPrincipal => ({
  subjectUserId: actor,
  principalUserId: actor,
  accountOwnerId: owner,
  subjectType: "sub_user",
});
const document = (
  group: string,
  effect: "Allow" | "Deny" = "Allow",
  action = "quyan:ram:ReadUser",
): IamPolicyDocument => ({
  Version: "1",
  Statement: {
    Effect: effect,
    Action: action,
    Resource: "*",
    Condition: { StringEquals: { "quyan:ResourceGroupId": group } },
  },
});
const evaluate = async (group: string, resources = [arn(target)]) =>
  iam.evaluateLoadedPolicies({
    principal: principal(),
    action: "quyan:ram:ReadUser",
    resources,
    policies: [{ policyId: "fixture", document: parseIamPolicy(document(group)).document }],
    context: { "quyan:ResourceGroupId": group },
  });
async function grant(doc: IamPolicyDocument, principalId = actor) {
  const policy = await ram.createPolicy(owner, { name: "group-condition-" + randomUUID(), document: doc });
  await ram.createAuthorization(owner, {
    principalType: "user",
    principalId,
    policyId: policy.id,
    scopeType: "account",
  });
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "group-condition-" + randomUUID(),
          password: "fixture-only",
          accountOwnerId,
          parentUserId: accountOwnerId,
          userType: accountOwnerId ? "ram_user" : "root",
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;
  owner = await user();
  actor = await user(owner);
  target = await user(owner);
  foreign = await user();
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
});
describe("live resource group policy conditions", () => {
  it("matches multiple memberships and removes the grant immediately when a member is removed", async () => {
    const first = await ram.createResourceGroup(owner, { name: "first" }),
      second = await ram.createResourceGroup(owner, { name: "second" });
    await ram.addResourceGroupMember(owner, first.id, { resourceArn: arn(target) });
    const member = await ram.addResourceGroupMember(owner, second.id, { resourceArn: arn(target) });
    expect((await evaluate(second.id))[0].decision).toBe("Allow");
    await ram.removeResourceGroupMember(owner, second.id, member.members[0].id);
    expect((await evaluate(second.id))[0].decision).toBe("ImplicitDeny");
    expect((await evaluate(first.id))[0].decision).toBe("Allow");
  });
  it("ignores disabled memberships and disabled groups", async () => {
    const group = await ram.createResourceGroup(owner, { name: "active" });
    const member = await ram.addResourceGroupMember(owner, group.id, { resourceArn: arn(target) });
    await prisma.ramResourceGroup.update({ where: { id: group.id }, data: { status: 0 } });
    expect((await evaluate(group.id))[0].decision).toBe("ImplicitDeny");
    await prisma.ramResourceGroup.update({ where: { id: group.id }, data: { status: 1 } });
    await prisma.ramResourceGroupMember.update({ where: { id: member.members[0].id }, data: { status: 0 } });
    expect((await evaluate(group.id))[0].decision).toBe("ImplicitDeny");
  });
  it("rejects foreign resources, exact-ID aliases and unavailable targets without unconditional rescue", async () => {
    const group = await ram.createResourceGroup(owner, { name: "isolation" });
    await ram.addResourceGroupMember(owner, group.id, { resourceArn: arn(target) });
    await expect(groups.conditionMemberships(owner, [arn(foreign, foreign)])).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await groups.resourceExistsInAccount(arn(target.toUpperCase()), owner)).toBe(false);
    expect(
      (await groups.conditionMemberships(owner, [arn(target.toUpperCase())])).get(arn(target.toUpperCase())),
    ).toEqual([]);
    const broad = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:ram:ReadUser", Resource: "*" },
    }).document;
    await prisma.user.update({ where: { id: target }, data: { status: -1 } });
    expect(
      (
        await iam.evaluateLoadedPolicies({
          principal: principal(),
          action: "quyan:ram:ReadUser",
          resources: [arn(target)],
          policies: [
            { policyId: "group", document: parseIamPolicy(document(group.id)).document },
            { policyId: "broad", document: broad },
          ],
        })
      )[0],
    ).toMatchObject({ decision: "ImplicitDeny", reason: "invalid-request" });
  });
  it("applies conditional Deny over Allow, with live changes and isolated simulation", async () => {
    const group = await ram.createResourceGroup(owner, { name: "denied" });
    const member = await ram.addResourceGroupMember(owner, group.id, { resourceArn: arn(target) });
    await grant({ Version: "1", Statement: { Effect: "Allow", Action: "quyan:ram:ReadUser", Resource: "*" } });
    await grant(document(group.id, "Deny"));
    const decide = () => iam.authorize({ principal: principal(), action: "quyan:ram:ReadUser", resource: arn(target) });
    expect((await decide()).decision).toBe("ExplicitDeny");
    expect((await ram.simulatePolicy(owner, actor, "quyan:ram:ReadUser", arn(target))).decision).toBe("ExplicitDeny");
    await ram.removeResourceGroupMember(owner, group.id, member.members[0].id);
    expect((await decide()).decision).toBe("Allow");
  });
  it("filters RAM user collection reads by trusted memberships", async () => {
    const group = await ram.createResourceGroup(owner, { name: "visible" });
    await ram.addResourceGroupMember(owner, group.id, { resourceArn: arn(target) });
    await grant(document(group.id));
    expect((await ram.listRamUserPage(actor)).items.map((user) => user.id)).toEqual([target]);
  });
  it("uses live role membership in trust evaluation and AssumeRole", async () => {
    const group = await ram.createResourceGroup(owner, { name: "trusted-roles" });
    await grant(
      { Version: "1", Statement: { Effect: "Allow", Action: "quyan:ram:UpdateRoleTrustPolicy", Resource: "*" } },
      owner,
    );
    const role = await ram.createRole(owner, {
      name: "group-trust",
      trustPolicy: {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "quyan:ram:AssumeRole",
          Resource: "*",
          Principal: { RAM: `acs:quyan::${owner}:user/${actor}` },
          Condition: { StringEquals: { "quyan:ResourceGroupId": group.id } },
        },
      },
    });
    const roleArn = `acs:quyan:*:${owner}:role/${role.id}`;
    await grant({ Version: "1", Statement: { Effect: "Allow", Action: "quyan:ram:AssumeRole", Resource: roleArn } });
    await expect(ram.assumeRole(actor, { roleId: role.id })).rejects.toMatchObject({ statusCode: 403 });
    const member = await ram.addResourceGroupMember(owner, group.id, { resourceArn: roleArn });
    expect((await ram.simulatePolicy(owner, actor, "quyan:ram:AssumeRole", roleArn)).decision).toBe("Allow");
    expect((await ram.assumeRole(actor, { roleId: role.id, durationSeconds: 900 })).session.roleId).toBe(role.id);
    await ram.removeResourceGroupMember(owner, group.id, member.members[0].id);
    expect((await ram.simulatePolicy(owner, actor, "quyan:ram:AssumeRole", roleArn)).decision).toBe("ImplicitDeny");
    await expect(ram.assumeRole(actor, { roleId: role.id })).rejects.toMatchObject({ statusCode: 403 });
  });
});
