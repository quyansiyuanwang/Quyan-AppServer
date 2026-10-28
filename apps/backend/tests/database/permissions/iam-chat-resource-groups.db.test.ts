import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { chatConversationArn, chatMessageArn } from "@/iam/resources/chat-resources";
import type { IamPrincipal } from "@quyan/shared";

let owner: string, actor: string, foreign: string;
const groups = RamResourceGroupRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "chat-group-fixture-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
beforeEach(async () => {
  owner = await user();
  actor = await user(owner);
  foreign = await user();
});

const conversation = (userId = actor) => prisma.conversation.create({ data: { userId } });

describe("chat resource-group storage boundaries", () => {
  it("verifies conversation and message owners without accepting foreign or case-alias identifiers", async () => {
    const target = await conversation();
    const message = await prisma.message.create({
      data: { conversationId: target.id, role: "user", content: "fixture" },
    });
    expect(await groups.resourceExistsInAccount(chatConversationArn(owner, target.id), owner)).toBe(true);
    expect(await groups.resourceExistsInAccount(chatMessageArn(owner, message.id), owner)).toBe(true);
    expect(await groups.resourceExistsInAccount(chatConversationArn(foreign, target.id), foreign)).toBe(false);
    expect(await groups.resourceExistsInAccount(chatMessageArn(foreign, message.id), foreign)).toBe(false);
    expect(await groups.resourceExistsInAccount(chatMessageArn(owner, message.id.toUpperCase()), owner)).toBe(false);
    await prisma.conversation.update({ where: { id: target.id }, data: { status: -1 } });
    expect(await groups.resourceExistsInAccount(chatConversationArn(owner, target.id), owner)).toBe(false);
    expect(await groups.resourceExistsInAccount(chatMessageArn(owner, message.id), owner)).toBe(false);
  });

  it("rejects disabled users and messages independently of the parent", async () => {
    const target = await conversation();
    const message = await prisma.message.create({
      data: { conversationId: target.id, role: "user", content: "fixture", status: 0 },
    });
    expect(await groups.resourceExistsInAccount(chatMessageArn(owner, message.id), owner)).toBe(false);
    await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    expect(await groups.resourceExistsInAccount(chatConversationArn(owner, target.id), owner)).toBe(false);
  });

  it("reevaluates group membership after removal without a stale scoped Allow", async () => {
    const target = await conversation();
    const arn = chatConversationArn(owner, target.id);
    const action = "quyan:chat:GetConversation";
    const group = await groups.create({ accountOwnerId: owner, name: "chat-fixture-" + randomUUID() });
    const member = await groups.addMember({
      accountOwnerId: owner,
      resourceGroupId: group.id,
      resourceArn: arn,
      service: "chat",
      resourceType: "conversation",
      resourceId: target.id,
    });
    const parsed = parseIamPolicy({ Version: "1", Statement: { Effect: "Allow", Action: action, Resource: arn } });
    const policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "chat-fixture-" + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
    await prisma.ramAuthorization.create({
      data: {
        accountOwnerId: owner,
        principalType: "user",
        principalId: actor,
        policyId: policy.id,
        scopeType: "resource-group",
        scopeResourceId: group.id,
        scopeKey: "resource-group:" + group.id,
        createdBy: owner,
      },
    });
    const principal: IamPrincipal = {
      subjectUserId: actor,
      principalUserId: actor,
      accountOwnerId: owner,
      subjectType: "sub_user",
    };
    const iam = IamAuthorizationService.getInstance();
    expect((await iam.authorize({ principal, action, resource: arn })).decision).toBe("Allow");
    await groups.removeMember(group.id, member.id);
    expect((await iam.authorize({ principal, action, resource: arn })).decision).toBe("ImplicitDeny");
  });
});
