import * as revisions from "@/store/users/iam-authorization-revision";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { TerminalInstallTokenRepository } from "@/store/remote-terminal-product/terminal-install-token.repository";
import { RemoteTerminalProductRepository } from "@/store/remote-terminal-product/remote-terminal-product.repository";
import { RemoteTerminalProductService } from "@/services/remote-terminal/remote-terminal-product.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { verifyInstallToken } from "@/modules/remote-terminal/install-token";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { remoteTerminalProductEntitlementArn } from "@/iam/resources/remote-terminal-resources";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode,
  originalSecret = env.integrations.remoteTerminal.installTokenSecret;
const FIXTURE_SECRET = "fixture-only-install-secret-".repeat(4);
let owner: string, actor: string, entitlement: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "install-token-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        parentUserId: accountOwnerId,
        userType: accountOwnerId ? "ram_user" : "root",
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "client:Fake" },
    ip: "192.0.2.42",
    secure: true,
  }) as unknown as TypedRequest;
const issue = () => RemoteTerminalProductService.getInstance().issueInstallToken(actor, entitlement, request());
async function deny() {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: {
      Effect: "Deny",
      Action: "quyan:remote_terminal:GetMyInstallToken",
      Resource: remoteTerminalProductEntitlementArn(owner, actor, entitlement),
    },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "install-deny-" + randomUUID(),
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
  env.integrations.remoteTerminal.installTokenSecret = FIXTURE_SECRET;
  owner = await user();
  actor = await user(owner);
  entitlement = (
    await prisma.remoteTerminalUserEntitlement.create({
      data: {
        userId: actor,
        name: "fixture entitlement",
        startAt: new Date("2026-01-01"),
        endAt: new Date("2027-01-01"),
        deviceLimit: 2,
        terminalLimit: 1,
      },
    })
  ).id;
  await prisma.remoteTerminalEntitlementToken.create({
    data: { entitlementId: entitlement, token: "PRIVATE-REGISTRATION-FIXTURE-" + randomUUID() },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
  env.integrations.remoteTerminal.installTokenSecret = originalSecret;
});
describe("install token entitlement signing boundary", () => {
  it("signs for the current user's entitlement without hydrating existing credentials", async () => {
    const hydrate = vi.spyOn(RemoteTerminalProductRepository.getInstance(), "findEntitlementById");
    const result = await issue();
    expect(verifyInstallToken(result.token, FIXTURE_SECRET)).toEqual({ entitlementId: entitlement });
    expect(hydrate).not.toHaveBeenCalled();
    const principal = getIamPrincipal(request())!,
      target = await TerminalInstallTokenRepository.getInstance().target(principal, entitlement);
    expect(Object.keys(target!).sort()).toEqual(["id", "userId", "status", "deviceLimit", "updateTime"].sort());
  });
  it("refuses an explicit entitlement denial before issuing a credential", async () => {
    await deny();
    await expect(issue()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("never signs another user's entitlement even for the account owner", async () => {
    await prisma.remoteTerminalUserEntitlement.update({ where: { id: entitlement }, data: { userId: owner } });
    await expect(issue()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses soft-deleted and zero-device entitlements", async () => {
    await prisma.remoteTerminalUserEntitlement.update({ where: { id: entitlement }, data: { deviceLimit: 0 } });
    await expect(issue()).rejects.toMatchObject({
      statusCode: 400,
      messageKey: "remoteTerminalProduct.registrationTokenUnavailable",
    });
    await prisma.remoteTerminalUserEntitlement.update({ where: { id: entitlement }, data: { status: -1 } });
    await expect(issue()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses timestamp-preserving source changes before generation", async () => {
    const repository = TerminalInstallTokenRepository.getInstance(),
      original = repository.issue.bind(repository),
      generated = vi.fn();
    vi.spyOn(repository, "issue").mockImplementation(async (target, guard, generate) => {
      await prisma.$executeRaw`UPDATE remote_terminal_user_entitlements SET deviceLimit=0 WHERE id=${entitlement}`;
      return original(target, guard, () => {
        generated();
        return generate();
      });
    });
    await expect(issue()).rejects.toMatchObject({ statusCode: 403 });
    expect(generated).not.toHaveBeenCalled();
  });
  it("refuses policy changes between preparation and signing", async () => {
    const repository = TerminalInstallTokenRepository.getInstance(),
      original = repository.issue.bind(repository);
    vi.spyOn(repository, "issue").mockImplementation(async (target, guard, generate) => {
      await deny();
      return original(target, guard, generate);
    });
    await expect(issue()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not return a credential when the final live decision denies", async () => {
    const repository = TerminalInstallTokenRepository.getInstance(),
      original = repository.issue.bind(repository),
      iam = IamAuthorizationService.getInstance();
    let generated = false;
    vi.spyOn(repository, "issue").mockImplementation(async (target, guard, generate) =>
      original(target, guard, async () => {
        const result = await generate();
        generated = true;
        vi.spyOn(iam, "authorize").mockResolvedValue({
          decision: "ExplicitDeny",
          reason: "explicit-deny",
          matchedStatements: [],
        });
        return result;
      }),
    );
    await expect(issue()).rejects.toMatchObject({ statusCode: 403 });
    expect(generated).toBe(true);
  });
  it("fails closed when latest policy data is unavailable", async () => {
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockRejectedValue(new Error("fixture unavailable"));
    await expect(issue()).rejects.toThrow("fixture unavailable");
  });
  it("refuses authorization revision drift and rolls back its transaction", async () => {
    const revision = vi
      .spyOn(revisions, "readIamAuthorizationRevision")
      .mockResolvedValueOnce("before")
      .mockResolvedValueOnce("changed");
    await expect(issue()).rejects.toMatchObject({ statusCode: 403 });
    expect(revision).toHaveBeenCalledTimes(2);
  });
});
