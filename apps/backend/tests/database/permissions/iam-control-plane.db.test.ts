import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamController } from "@/api/controllers/v1/users/ram.controller";
import { RamService } from "@/services/users/ram.service";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";
import { Permission } from "@quyan/shared";
const service = RamService.getInstance(),
  controller = new RamController();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, first: string, second: string;
const arn = (kind: string, id: string) => "acs:quyan:*:" + owner + ":" + kind + "/" + id;
async function grant(action: string, resource: string | string[], effect: "Allow" | "Deny" = "Allow") {
  const policy = await service.createPolicy(owner, {
    name: "control-grant-" + randomUUID(),
    document: {
      Version: "1",
      Statement: { Effect: effect, Action: action, Resource: resource },
    },
  });
  await service.createAuthorization(owner, {
    principalType: "user",
    principalId: actor,
    policyId: policy.id,
    scopeType: "account",
  });
}
const run = <T>(params: Record<string, string>, body: unknown, operation: (request: TypedRequest) => Promise<T>) =>
  new AsyncResource("iam-control-plane-fixture").runInAsyncScope(async () => {
    const request = {
      user: { userId: actor },
      params,
      body,
      headers: { "x-action": "quyan:ram:UpdateUser", "x-account-id": "foreign" },
      secure: true,
      authContext: { principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user" },
    } as unknown as TypedRequest;
    setRequestContext(request);
    return operation(request);
  });
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "control-user-" + randomUUID(),
          password: "fixture-only",
          userType: accountOwnerId ? "ram_user" : "root",
          accountOwnerId,
          parentUserId: accountOwnerId,
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;
  owner = await user();
  actor = await user(owner);
  first = await user(owner);
  second = await user(owner);
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
});
describe("decorated IAM control-plane resource checks", () => {
  it("allows modifying one user, denies another and keeps the server action despite forged headers", async () => {
    await grant("quyan:ram:UpdateUser", arn("user", first));
    const body = { displayName: "Updated fixture" };
    expect(
      (await run({ userId: first }, body, (request) => controller.updateUser(first, body, request))).displayName,
    ).toBe(body.displayName);
    await expect(
      run({ userId: second }, body, (request) => controller.updateUser(second, body, request)),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(run({ userId: first }, {}, (request) => controller.deleteUser(first, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: second } })).displayName).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: first } })).status).toBe(1);
  });
  it("does not permit a user-scoped editor to acquire a privileged group through profile updates", async () => {
    const group = await prisma.group.create({
      data: {
        username: "privileged-" + randomUUID(),
        accountOwnerId: owner,
        permissions: [Permission.RAM_POLICY_DELETE],
      },
    });
    await grant("quyan:ram:UpdateUser", [arn("user", actor), arn("group", group.id)]);
    const body = { groupId: group.id };
    await expect(
      run({ userId: actor }, body, (request) => controller.updateUser(actor, body, request)),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).groupId).toBeNull();
  });
  it("requires permission on both the role and target user before creating a binding", async () => {
    const role = await service.createRole(owner, { name: "pair-role-" + randomUUID() });
    await grant("quyan:ram:binding:Create", arn("role", role.id));
    const body = { userId: first };
    await expect(
      run({ roleId: role.id }, body, (request) => controller.bindRoleToUser(role.id, body, request)),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.ramUserRoleBinding.count({ where: { roleId: role.id } })).toBe(0);
    await grant("quyan:ram:binding:Create", arn("user", first));
    await run({ roleId: role.id }, body, (request) => controller.bindRoleToUser(role.id, body, request));
    expect(await prisma.ramUserRoleBinding.count({ where: { roleId: role.id, userId: first } })).toBe(1);
    await expect(
      run({ roleId: role.id }, { userId: second }, (request) =>
        controller.bindRoleToUser(role.id, { userId: second }, request),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires the exact candidate version as well as the policy before switching the default", async () => {
    const policy = await service.createPolicy(owner, {
      name: "version-target-" + randomUUID(),
      document: {
        Version: "1",
        Statement: { Effect: "Allow", Action: "quyan:ram:ReadUser", Resource: arn("user", first) },
      },
    });
    const version = (await service.listPolicyVersions(owner, policy.id)).items[0]!;
    const updated = await service.updatePolicy(owner, policy.id, {
      document: {
        Version: "1",
        Statement: { Effect: "Allow", Action: "quyan:ram:ReadUser", Resource: arn("user", second) },
      },
      expectedDocumentHash: policy.documentHash,
    });
    await grant("quyan:ram:UpdatePolicy", arn("policy", policy.id));
    await grant("quyan:ram:ReadUser", arn("user", first));
    const body = { versionId: version.id, expectedDocumentHash: updated.documentHash! };
    await expect(
      run({ policyId: policy.id }, body, (request) => controller.setDefaultPolicyVersion(policy.id, body, request)),
    ).rejects.toMatchObject({ statusCode: 403 });
    await grant("quyan:ram:UpdatePolicy", arn("policy-version", policy.id + "/" + version.id));
    await run({ policyId: policy.id }, body, (request) => controller.setDefaultPolicyVersion(policy.id, body, request));
    expect((await prisma.ramPolicy.findUniqueOrThrow({ where: { id: policy.id } })).defaultVersionId).toBe(version.id);
  });
  it("preserves legacy account-wide target access but explicit Deny still overrides it", async () => {
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.RAM_USER_UPDATE] } });
    await grant("quyan:ram:UpdateUser", arn("user", second), "Deny");
    const body = { displayName: "legacy fixture" };
    await run({ userId: first }, body, (request) => controller.updateUser(first, body, request));
    await expect(
      run({ userId: second }, body, (request) => controller.updateUser(second, body, request)),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
