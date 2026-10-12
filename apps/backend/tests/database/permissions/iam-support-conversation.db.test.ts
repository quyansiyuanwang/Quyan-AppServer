import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { IamAccountUserRepository } from "@/store/users/iam-account-principal";
import { IamAccountUserAuthorizationService } from "@/services/users/iam-account-user-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { onlineUserArn } from "@/iam/resources/online-session-resources";
import type { TypedRequest } from "@/types/express";
import type { IamPrincipal } from "@quyan/shared";
let owner: string, actor: string, peer: string, foreign: string;
const repository = IamAccountUserRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "support-read-" + randomUUID(),
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
  peer = await user(owner);
  foreign = await user();
});
const principal = (accountOwnerId = owner): IamPrincipal => ({
  subjectUserId: actor,
  principalUserId: actor,
  accountOwnerId,
  subjectType: "sub_user",
});
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
  }) as unknown as TypedRequest;
async function bind(document: unknown) {
  const parsed = parseIamPolicy(document),
    policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "support-read-" + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
  return prisma.ramAuthorization.create({
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
describe("support conversation account user authorization", () => {
  it("looks up real same-account targets and cannot read users from other accounts", async () => {
    expect((await repository.target(principal(), peer))?.id).toBe(peer);
    expect(await repository.target(principal(), foreign)).toBeNull();
    await expect(repository.target(principal(foreign), peer)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("authorizes one selected user without disclosing another user conversation", async () => {
    await bind({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:support:GetUserConversation", Resource: onlineUserArn(owner, peer) },
    });
    let reads = 0;
    const read = async (id: string) => {
        reads++;
        return { userId: id, messages: [] };
      },
      service = IamAccountUserAuthorizationService.getInstance();
    expect(await service.read("quyan:support:GetUserConversation", peer, request(), read)).toEqual({
      userId: peer,
      messages: [],
    });
    await expect(service.read("quyan:support:GetUserConversation", actor, request(), read)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(reads).toBe(1);
  });
  it("explicit Deny prevents the private content callback", async () => {
    await bind({
      Version: "1",
      Statement: [
        { Effect: "Allow", Action: "quyan:support:GetUserConversation", Resource: onlineUserArn(owner, peer) },
        { Effect: "Deny", Action: "quyan:support:GetUserConversation", Resource: onlineUserArn(owner, peer) },
      ],
    });
    let reads = 0;
    await expect(
      IamAccountUserAuthorizationService.getInstance().read(
        "quyan:support:GetUserConversation",
        peer,
        request(),
        async () => {
          reads++;
          return {};
        },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(reads).toBe(0);
  });
  it("withholds private content if permission is revoked during the read", async () => {
    const binding = await bind({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:support:GetUserConversation", Resource: onlineUserArn(owner, peer) },
    });
    await expect(
      IamAccountUserAuthorizationService.getInstance().read(
        "quyan:support:GetUserConversation",
        peer,
        request(),
        async () => {
          await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
          return { messages: [] };
        },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("withholds data after target changes, and checks disabled owners and revoked role sessions", async () => {
    await bind({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:support:GetUserConversation", Resource: onlineUserArn(owner, peer) },
    });
    await expect(
      IamAccountUserAuthorizationService.getInstance().read(
        "quyan:support:GetUserConversation",
        peer,
        request(),
        async () => {
          await prisma.user.update({ where: { id: peer }, data: { updateTime: new Date(Date.now() + 1000) } });
          return { messages: [] };
        },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      repository.target(
        { ...principal(), subjectType: "assumed_role", roleSessionId: "missing", assumedRoleId: "role" },
        peer,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(repository.target(principal(), peer)).rejects.toMatchObject({ statusCode: 403 });
  });
});
