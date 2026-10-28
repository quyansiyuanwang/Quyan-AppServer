import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { env } from "@/config/env";
import { prisma } from "@/config/database";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamService } from "@/services/users/ram.service";
import { ArticleManagementRepository } from "@/store/content/article-management.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { articleArn } from "@/iam/resources/article-resources";
import type { IamPrincipal, IamPolicyDocument } from "@quyan/shared";
let owner: string, actor: string, peer: string, foreign: string;
const iam = IamAuthorizationService.getInstance(),
  ram = RamService.getInstance();
const principal = (): IamPrincipal => ({
  subjectUserId: actor,
  principalUserId: actor,
  accountOwnerId: owner,
  subjectType: "sub_user",
});
const article = (authorId = actor) =>
  prisma.article.create({
    data: {
      authorId,
      title: "Ownership condition fixture",
      content: "Synthetic content",
      slug: "owner-condition-" + randomUUID(),
    },
  });
const document = (expectedOwner = actor): IamPolicyDocument => ({
  Version: "1",
  Statement: {
    Effect: "Allow",
    Action: "quyan:article:Update",
    Resource: "acs:article:*:" + owner + ":article/*",
    Condition: { StringEquals: { "quyan:ResourceOwnerId": expectedOwner } },
  },
});
const policies = () => [{ policyId: "ownership-fixture", document: parseIamPolicy(document()).document }];
const originalMode = env.security.iamAuthorizationMode;
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
});
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "owner-condition-" + randomUUID(),
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
  peer = await user(owner);
  foreign = await user();
});
describe("persisted article ownership condition provider", () => {
  it("uses stored author identity, not the account encoded in the ARN or submitted attributes", async () => {
    const own = await article(),
      other = await article(peer);
    const result = await iam.evaluateLoadedPolicies({
      principal: principal(),
      action: "quyan:article:Update",
      resources: [articleArn(owner, own.id), articleArn(owner, other.id)],
      policies: policies(),
      context: { "quyan:ResourceOwnerId": actor },
    });
    expect(result.map((entry) => entry.decision)).toEqual(["Allow", "ImplicitDeny"]);
  });
  it("resolves live authorization and isolated simulation drafts through the same provider", async () => {
    const own = await article(),
      other = await article(peer);
    const policy = await ram.createPolicy(owner, { name: "owner-condition-" + randomUUID(), document: document() });
    await ram.createAuthorization(owner, {
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "account",
    });
    for (const [target, expected] of [
      [own, "Allow"],
      [other, "ImplicitDeny"],
    ] as const) {
      expect(
        (
          await iam.authorize({
            principal: principal(),
            action: "quyan:article:Update",
            resource: articleArn(owner, target.id),
          })
        ).decision,
      ).toBe(expected);
      expect(
        (
          await ram.simulatePolicy(
            owner,
            actor,
            "quyan:article:Update",
            articleArn(owner, target.id),
            JSON.stringify(document()),
          )
        ).decision,
      ).toBe(expected);
    }
  });
  it("rejects case aliases, foreign and deleted targets independently in a mixed batch", async () => {
    const own = await article(),
      deleted = await article(),
      other = await article(foreign);
    await prisma.article.update({ where: { id: deleted.id }, data: { status: -1 } });
    const resources = [own.id, own.id.toUpperCase(), deleted.id, other.id, "missing"].map((id) =>
      articleArn(owner, id),
    );
    const results = await iam.evaluateLoadedPolicies({
      principal: principal(),
      action: "quyan:article:Update",
      resources,
      policies: policies(),
    });
    expect(results.map((entry) => entry.decision)).toEqual([
      "Allow",
      "ImplicitDeny",
      "ImplicitDeny",
      "ImplicitDeny",
      "ImplicitDeny",
    ]);
    expect(await ArticleManagementRepository.getInstance().findTargets([own.id, "missing"], owner)).toBeUndefined();
    expect(await ArticleManagementRepository.getInstance().findTargets([], owner)).toBeUndefined();
  });
  it("observes author/account status and ownership changes without a stale cache", async () => {
    const own = await article();
    const authorize = () =>
      iam.evaluateLoadedPolicies({
        principal: principal(),
        action: "quyan:article:Update",
        resources: [articleArn(owner, own.id)],
        policies: policies(),
      });
    expect((await authorize())[0].decision).toBe("Allow");
    await prisma.article.update({ where: { id: own.id }, data: { authorId: peer } });
    expect((await authorize())[0].decision).toBe("ImplicitDeny");
    await prisma.user.update({ where: { id: peer }, data: { status: 0 } });
    expect((await authorize())[0].reason).toBe("invalid-request");
  });
});
