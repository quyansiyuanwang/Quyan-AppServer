import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { IamPolicyDocument } from "@quyan/shared";
const ram = RamService.getInstance(),
  iam = IamAuthorizationService.getInstance();
const mode = env.security.iamAuthorizationMode;
let owner: string, actor: string;
const arn = () => "acs:quyan:*:" + owner + ":user/" + actor;
const candidate = (): IamPolicyDocument => ({
  Version: "1",
  Statement: {
    Effect: "Allow",
    NotAction: "quyan:ram:DeleteUser",
    Resource: arn(),
  },
});
const principal = () => ({
  subjectUserId: actor,
  principalUserId: actor,
  accountOwnerId: owner,
  subjectType: "sub_user" as const,
});
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "notaction-user-" + randomUUID(),
        password: "fixture-only",
        userType: accountOwnerId ? "ram_user" : "root",
        accountOwnerId,
        parentUserId: accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("NotAction publishes only a proven exact version snapshot", () => {
  it("stores and evaluates explicit actions, not a dynamic complement expression", async () => {
    const input = candidate();
    const policy = await ram.createPolicy(owner, { name: "snapshot-" + randomUUID(), document: input });
    const stored = await prisma.ramPolicyVersion.findFirstOrThrow({ where: { policyId: policy.id } });
    expect(JSON.stringify(stored.document)).not.toContain("NotAction");
    expect(stored.document).toEqual(parseIamPolicy(input).document);
    expect(stored.documentHash).toBe(parseIamPolicy(stored.document).documentHash);
    await ram.createAuthorization(owner, {
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "account",
    });
    expect(
      (await iam.authorize({ principal: principal(), action: "quyan:ram:ReadUser", resource: arn() })).decision,
    ).toBe("Allow");
    expect(
      (await iam.authorize({ principal: principal(), action: "quyan:ram:DeleteUser", resource: arn() })).decision,
    ).toBe("ImplicitDeny");
    expect(
      (
        await iam.authorize({
          principal: principal(),
          action: "quyan:ram:ReadUser",
          resource: "acs:quyan:*:" + owner + ":user/other",
        })
      ).decision,
    ).toBe("ImplicitDeny");
  });
  it("rejects broad NotAction self-delegation without creating a partial policy or version", async () => {
    const narrow = await ram.createPolicy(owner, {
      name: "narrow-" + randomUUID(),
      document: {
        Version: "1",
        Statement: { Effect: "Allow", Action: "quyan:ram:ReadUser", Resource: arn() },
      },
    });
    await ram.createAuthorization(owner, {
      principalType: "user",
      principalId: actor,
      policyId: narrow.id,
      scopeType: "account",
    });
    const name = "unproven-" + randomUUID();
    await expect(ram.createPolicy(actor, { name, document: candidate() })).rejects.toMatchObject({
      statusCode: 403,
      messageKey: "iam.delegationDenied",
    });
    expect(await prisma.ramPolicy.count({ where: { name, accountOwnerId: owner } })).toBe(0);
    expect(await prisma.ramPolicyVersion.count({ where: { createdBy: actor } })).toBe(0);
  });
});
