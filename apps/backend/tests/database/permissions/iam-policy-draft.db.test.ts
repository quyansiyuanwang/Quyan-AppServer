import { env } from "@/config/env";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { ChatService } from "@/services/chat/chat.service";
import { RamService } from "@/services/users/ram.service";
import { iamAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";
import { ramAccountResourceResolver } from "@/iam/request/resource-resolvers";
import type { TypedRequest } from "@/types/express";
const ram = RamService.getInstance();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string;
const input = { instruction: "Read one user", model: "fixture-model", relayTokenId: "fixture-token" };
const middleware = iamAuthorizationMiddleware({
  action: "quyan:ram:GeneratePolicyDraft",
  resourceKind: "account",
  resource: ramAccountResourceResolver,
});
const requestFor = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user" },
    headers: { "x-action": "quyan:ram:CreatePolicy", "x-account-id": "foreign" },
    secure: true,
    res: { locals: { requestId: "fixture-draft" } },
  }) as unknown as TypedRequest;
const authorize = async () => {
  const request = requestFor();
  let error: unknown;
  await middleware(request, {} as never, (value) => {
    error = value;
  });
  if (error) throw error;
};
const grant = async (action: string, effect: "Allow" | "Deny" = "Allow") => {
  const policy = await ram.createPolicy(owner, {
    name: "draft-" + randomUUID(),
    document: { Version: "1", Statement: { Effect: effect, Action: action, Resource: "*" } },
  });
  await ram.createAuthorization(owner, {
    principalType: "user",
    principalId: actor,
    policyId: policy.id,
    scopeType: "account",
  });
};
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  owner = (
    await prisma.user.create({
      data: {
        username: "draft-owner-" + randomUUID(),
        password: "fixture-only",
        userType: "root",
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
  actor = (
    await prisma.user.create({
      data: {
        username: "draft-actor-" + randomUUID(),
        password: "fixture-only",
        userType: "ram_user",
        accountOwnerId: owner,
        parentUserId: owner,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
  vi.restoreAllMocks();
});
describe("policy draft account admission and publication isolation", () => {
  it("requires the dedicated action and applies an explicit Deny despite forged action headers", async () => {
    await expect(authorize()).rejects.toMatchObject({ statusCode: 403 });
    await grant("quyan:ram:CreatePolicy");
    await expect(authorize()).rejects.toMatchObject({ statusCode: 403 });
    await grant("quyan:ram:GeneratePolicyDraft");
    await expect(authorize()).resolves.toBeUndefined();
    await grant("quyan:ram:GeneratePolicyDraft", "Deny");
    await expect(authorize()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("proves generated identity grants against stored policies without creating policies, versions, authorizations or conversations", async () => {
    await grant("quyan:ram:GeneratePolicyDraft");
    await grant("quyan:ram:ReadUser");
    const generated = {
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:ram:ReadUser", Resource: "acs:quyan:*:" + owner + ":user/" + actor },
    };
    vi.spyOn(ChatService.getInstance(), "generateTextForUser").mockResolvedValue(JSON.stringify(generated));
    const snapshot = () =>
      Promise.all([
        prisma.ramPolicy.count(),
        prisma.ramPolicyVersion.count(),
        prisma.ramAuthorization.count(),
        prisma.conversation.count(),
        prisma.message.count(),
      ]);
    const before = await snapshot();
    await authorize();
    const result = await ram.generatePolicyDraft(actor, input);
    expect(result.delegation).toBe("allowed");
    expect(result.document).toBeDefined();
    expect(await snapshot()).toEqual(before);
  });
  it("returns high risk when the real principal cannot delegate a model-generated grant", async () => {
    await grant("quyan:ram:GeneratePolicyDraft");
    vi.spyOn(ChatService.getInstance(), "generateTextForUser").mockResolvedValue(
      JSON.stringify({
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "quyan:ram:DeleteUser",
          Resource: "acs:quyan:*:" + owner + ":user/" + actor,
        },
      }),
    );
    await authorize();
    const result = await ram.generatePolicyDraft(actor, input);
    expect(result.delegation).toBe("denied");
    expect(result.riskLevel).toBe("high");
  });
});
