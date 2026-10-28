import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { env } from "@/config/env";
import { prisma } from "@/config/database";
import { RamService } from "@/services/users/ram.service";
const service = RamService.getInstance();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, foreign: string;
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "draft-sim-" + randomUUID(),
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
  foreign = await user();
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
});
describe("unpublished policy simulation isolation", () => {
  it("keeps bound and draft evaluation separate without saving or binding generated grants", async () => {
    const policy = await service.createPolicy(owner, {
      name: "bound-deny-" + randomUUID(),
      document: { Version: "1", Statement: { Effect: "Deny", Action: "quyan:ram:ReadUser", Resource: "*" } },
    });
    await service.createAuthorization(owner, {
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "account",
    });
    const resource = "acs:quyan:*:" + owner + ":user/" + actor;
    const documentText = JSON.stringify({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:ram:ReadUser", Resource: resource },
    });
    const counts = () =>
      Promise.all([prisma.ramPolicy.count(), prisma.ramPolicyVersion.count(), prisma.ramAuthorization.count()]);
    const before = await counts();
    expect((await service.simulatePolicy(owner, actor, "quyan:ram:ReadUser", resource)).decision).toBe("ExplicitDeny");
    expect((await service.simulatePolicy(owner, actor, "quyan:ram:ReadUser", resource, documentText)).decision).toBe(
      "Allow",
    );
    expect(await counts()).toEqual(before);
    expect((await service.simulatePolicy(owner, actor, "quyan:ram:ReadUser", resource)).decision).toBe("ExplicitDeny");
  });
  it("still enforces stored role trust when the identity grant comes from a draft", async () => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "draft-role-" + randomUUID() } });
    const resource = "acs:quyan:*:" + owner + ":role/" + role.id;
    const documentText = JSON.stringify({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:ram:AssumeRole", Resource: resource },
    });
    expect((await service.simulatePolicy(owner, actor, "quyan:ram:AssumeRole", resource, documentText)).decision).toBe(
      "ImplicitDeny",
    );
    await prisma.ramRole.update({
      where: { id: role.id },
      data: {
        trustPolicy: {
          Version: "1",
          Statement: {
            Effect: "Deny",
            Action: "quyan:ram:AssumeRole",
            Principal: { RAM: "acs:quyan::" + owner + ":user/" + actor },
            Resource: resource,
          },
        },
      },
    });
    expect((await service.simulatePolicy(owner, actor, "quyan:ram:AssumeRole", resource, documentText)).decision).toBe(
      "ExplicitDeny",
    );
  });
  it("rejects simulated principals and resources outside the authenticated account", async () => {
    const documentText = JSON.stringify({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:ram:ReadUser", Resource: "*" },
    });
    await expect(service.simulatePolicy(owner, foreign, "quyan:ram:ReadUser", "*", documentText)).rejects.toMatchObject(
      { statusCode: 403 },
    );
    expect(
      (
        await service.simulatePolicy(
          owner,
          actor,
          "quyan:ram:ReadUser",
          "acs:quyan:*:" + foreign + ":user/" + foreign,
          documentText,
        )
      ).decision,
    ).toBe("ImplicitDeny");
  });
});
