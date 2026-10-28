import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { RamController } from "@/api/controllers/v1/users/ram.controller";
import { Permission } from "@quyan/shared";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";
const service = RamService.getInstance(),
  controller = new RamController(),
  mode = env.security.iamAuthorizationMode;
let owner: string, actor: string, foreign: string, policyId: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "attachment-user-" + randomUUID(),
        displayName: "Target user fixture",
        password: "fixture-only",
        userType: accountOwnerId ? "ram_user" : "root",
        accountOwnerId,
        parentUserId: accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const arn = (kind: string, id: string) => "acs:quyan:*:" + owner + ":" + kind + "/" + id;
const attachment = (targetType: string, targetId: string, accountOwnerId = owner) =>
  prisma.ramPolicyAttachment.create({ data: { accountOwnerId, policyId, targetType, targetId } });
async function grant(action: string, resource: string | string[], effect: "Allow" | "Deny" = "Allow") {
  const policy = await service.createPolicy(owner, {
    name: "attachment-grant-" + randomUUID(),
    document: { Version: "1", Statement: { Effect: effect, Action: action, Resource: resource } },
  });
  await service.createAuthorization(owner, {
    principalType: "user",
    principalId: actor,
    policyId: policy.id,
    scopeType: "account",
  });
}
const run = <T>(operation: (request: TypedRequest) => Promise<T>) =>
  new AsyncResource("attachment-page-fixture").runInAsyncScope(async () => {
    const request = {
      user: { userId: actor },
      params: { policyId },
      headers: {},
      ip: "127.0.0.1",
      secure: true,
      authContext: { principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user" },
    } as unknown as TypedRequest;
    setRequestContext(request);
    return operation(request);
  });
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  foreign = await user();
  policyId = (
    await service.createPolicy(owner, {
      name: "attachment-parent-" + randomUUID(),
      document: { Version: "1", Statement: { Effect: "Allow", Action: "quyan:ram:ReadUser", Resource: "*" } },
    })
  ).id;
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("paged policy attachments protect target identities", () => {
  it("requires parent and target read access and preserves explicit target Deny", async () => {
    const a = await user(owner),
      b = await user(owner);
    const older = await attachment("user", a);
    await attachment("user", b);
    await prisma.ramPolicyAttachment.update({
      where: { id: older.id },
      data: { createTime: new Date("2020-01-01T00:00:00Z") },
    });
    await grant("quyan:ram:ReadPolicy", arn("policy", policyId));
    expect((await run((request) => controller.listPolicyAttachmentsPage(policyId, request))).items).toEqual([]);
    await grant("quyan:ram:ReadUser", [arn("user", a), arn("user", b)]);
    await grant("quyan:ram:ReadUser", arn("user", b), "Deny");
    const first = await run((request) => controller.listPolicyAttachmentsPage(policyId, request, 1, 1));
    expect(first.items).toEqual([]);
    expect(first.hasNext).toBe(true);
    const next = await run((request) => controller.listPolicyAttachmentsPage(policyId, request, 2, 1));
    expect(next.items[0]).toMatchObject({ id: older.id, targetId: a, targetName: "Target user fixture" });
    expect(next.hasNext).toBe(false);
    expect(next).not.toHaveProperty("total");
    expect(
      (await run((request) => controller.listPolicyAttachments(policyId, request))).map((item) => item.id),
    ).toEqual([older.id]);
  });
  it("uses the registered read Action for each target type without treating policy read as target read", async () => {
    const a = await user(owner),
      g = await prisma.group.create({
        data: {
          username: "attachment-group-" + randomUUID(),
          accountOwnerId: owner,
          name: "Group fixture",
          permissions: [],
        },
      }),
      role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "Role fixture" } });
    const rows = [await attachment("user", a), await attachment("group", g.id), await attachment("role", role.id)];
    await grant("quyan:ram:ReadPolicy", arn("policy", policyId));
    await grant("quyan:ram:ReadUser", arn("user", a));
    await grant("quyan:group:Read", arn("group", g.id));
    await grant("quyan:ram:role:Read", arn("role", role.id));
    const result = await run((request) => controller.listPolicyAttachmentsPage(policyId, request));
    expect(result.items.map((item) => item.id).sort()).toEqual(rows.map((item) => item.id).sort());
    expect(result.items.map((item) => item.targetName).sort()).toEqual(
      ["Target user fixture", "Group fixture", "Role fixture"].sort(),
    );
  });
  it("never resolves foreign, deleted, unsupported or mismatched target identities into the response", async () => {
    const a = await user(owner),
      external = await user(foreign),
      deleted = await user(owner);
    const valid = await attachment("user", a);
    await attachment("user", external);
    await attachment("user", deleted);
    await prisma.user.update({ where: { id: deleted }, data: { status: -1 } });
    await attachment("user", "missing-fixture");
    await attachment("unknown", "unknown-fixture");
    await attachment("user", a, foreign);
    const foreignGroup = await prisma.group.create({
      data: { username: "foreign-group-" + randomUUID(), accountOwnerId: foreign, permissions: [] },
    });
    await attachment("group", foreignGroup.id);
    await grant("quyan:ram:ReadPolicy", arn("policy", policyId));
    await grant("quyan:ram:ReadUser", "*");
    await grant("quyan:group:Read", "*");
    const result = await run((request) => controller.listPolicyAttachmentsPage(policyId, request, 1, 100));
    expect(result.items.map((item) => item.id)).toEqual([valid.id]);
    expect(result.hasNext).toBe(false);
  });
  it("checks the actual parent policy for internal callers and rejects foreign parent policies", async () => {
    const target = await user(owner);
    await attachment("user", target);
    await grant("quyan:ram:ReadUser", arn("user", target));
    await expect(service.listPolicyAttachmentPage(actor, policyId)).rejects.toMatchObject({ statusCode: 403 });
    const external = await service.createPolicy(foreign, { name: "foreign-parent-" + randomUUID(), permissions: [] });
    await expect(service.listPolicyAttachmentPage(actor, external.id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.listPolicyAttachmentPage(actor, policyId, { page: 0 })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(service.listPolicyAttachmentPage(actor, policyId, { pageSize: 101 })).rejects.toMatchObject({
      statusCode: 400,
    });
  });
  it("keeps legacy/shadow list entry checks while returning bounded valid same-account candidates", async () => {
    const a = await user(owner),
      b = await user(owner),
      rows = [await attachment("user", a), await attachment("user", b)];
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.RAM_POLICY_READ] } });
    for (const authorizationMode of ["legacy", "shadow"] as const) {
      env.security.iamAuthorizationMode = authorizationMode;
      const first = await run((request) => controller.listPolicyAttachmentsPage(policyId, request, 1, 1));
      const last = await run((request) => controller.listPolicyAttachmentsPage(policyId, request, 2, 1));
      expect([first.items[0]!.id, last.items[0]!.id].sort()).toEqual(rows.map((item) => item.id).sort());
      expect(first.hasNext).toBe(true);
      expect(last.hasNext).toBe(false);
    }
  });
});
