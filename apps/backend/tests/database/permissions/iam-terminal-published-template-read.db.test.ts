import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RemoteTerminalProductService } from "@/services/remote-terminal/remote-terminal-product.service";
import { RemoteTerminalProductRepository } from "@/store/remote-terminal-product/remote-terminal-product.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { remoteTerminalPublishedTemplateArn } from "@/iam/resources/remote-terminal-resources";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode;
let owner: string, actor: string, peer: string, offers: string[], draft: string, disabled: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "offer-read-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        parentUserId: accountOwnerId,
        userType: accountOwnerId ? "ram_user" : "root",
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const request = (context: Partial<NonNullable<TypedRequest["authContext"]>> = {}) =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user", ...context },
    headers: {},
    secure: true,
    ip: "192.0.2.42",
  }) as unknown as TypedRequest;
const read = (req = request()) => RemoteTerminalProductService.getInstance().listPublishedTemplates(req);
async function deny(resource: string, action = "quyan:remote_terminal:ListPublishedTemplates") {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect: "Deny", Action: action, Resource: resource } });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "offer-deny-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
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
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  peer = await user(owner);
  offers = [];
  const offer = async (status: number, publishStatus: string, at: number) =>
    (
      await prisma.remoteTerminalProductTemplate.create({
        data: {
          name: "published-offer-" + randomUUID(),
          status,
          publishStatus,
          publishedAt: new Date(Date.UTC(2026, at, 1)),
          devicePrice: 1,
          terminalPrice: 2,
        },
      })
    ).id;
  offers.push(await offer(1, "published", 9), await offer(1, "published", 8));
  draft = await offer(1, "draft", 10);
  disabled = await offer(0, "published", 11);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.remoteTerminalProductTemplate.deleteMany({ where: { id: { in: [...offers, draft, disabled] } } });
  env.security.iamAuthorizationMode = mode;
});
describe("IAM published terminal offer reads", () => {
  it("keeps the published ordering and pricing without platform management access", async () => {
    const legacy = vi.spyOn(RemoteTerminalProductRepository.getInstance(), "listPublishedTemplates");
    const result = await read();
    expect(result.map((row) => row.id)).toEqual(offers);
    expect(result[0]).toMatchObject({
      devicePrice: 1,
      terminalPrice: 2,
      billingUnit: "day",
      status: 1,
      publishStatus: "published",
    });
    expect(result.map((row) => row.id)).not.toContain(draft);
    expect(result.map((row) => row.id)).not.toContain(disabled);
    expect(legacy).not.toHaveBeenCalled();
  });
  it("filters a specific denied offer", async () => {
    await deny(remoteTerminalPublishedTemplateArn(owner, actor, offers[0]!));
    expect((await read()).map((row) => row.id)).toEqual([offers[1]]);
  });
  it("honors wildcard Deny despite the authenticated offer baseline", async () => {
    await deny("acs:remote-terminal:*:" + owner + ":published-template/" + actor + "/*");
    expect(await read()).toEqual([]);
  });
  it("does not apply a same-account peer's offer scope to the actor", async () => {
    await deny(remoteTerminalPublishedTemplateArn(owner, peer, offers[0]!));
    expect((await read()).map((row) => row.id)).toEqual(offers);
  });
  it("keeps viewing and purchasing actions independent", async () => {
    await deny(
      remoteTerminalPublishedTemplateArn(owner, actor, offers[0]!),
      "quyan:remote_terminal:ClaimPublishedTemplate",
    );
    expect((await read()).map((row) => row.id)).toEqual(offers);
  });
  it("rejects forged account ownership and disabled identities", async () => {
    const foreign = await user();
    await expect(read(request({ accountOwnerId: foreign }))).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks every admitted decision before returning the collection", async () => {
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    let count = 0;
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const result = await original(input);
      if (++count > 1) return result.map((row) => ({ ...row, decision: "ExplicitDeny", reason: "explicit-deny" }));
      return result;
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("accepts AccessKey identity through the same trusted context", async () => {
    expect((await read(request({ subjectType: "access_key" }))).map((row) => row.id)).toEqual(offers);
  });
  it("rejects a missing role session and missing request in enforce mode", async () => {
    await expect(
      read(request({ roleSessionId: "missing-session", assumedRoleId: "missing-role" })),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(RemoteTerminalProductService.getInstance().listPublishedTemplates()).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
