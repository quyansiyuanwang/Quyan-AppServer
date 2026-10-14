import * as revisions from "@/store/users/iam-authorization-revision";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { TerminalRegistrationRotationIamService } from "@/services/remote-terminal/terminal-registration-rotation-iam.service";
import { TerminalRegistrationRotationRepository } from "@/store/remote-terminal-product/terminal-registration-rotation.repository";
import { RemoteTerminalProductRepository } from "@/store/remote-terminal-product/remote-terminal-product.repository";
import { RemoteTerminalProductService } from "@/services/remote-terminal/remote-terminal-product.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import {
  platformTerminalEntitlementArn,
  platformTerminalRegistrationTokenArn,
} from "@/iam/resources/platform-terminal-entitlement-resources";
import {
  remoteTerminalProductEntitlementArn,
  remoteTerminalProductRegistrationTokenArn,
} from "@/iam/resources/remote-terminal-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import BusinessLogService from "@/services/system/businesslog.service";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode,
  repository = TerminalRegistrationRotationRepository.getInstance(),
  authority = TerminalRegistrationRotationIamService.getInstance();
const NEW_TOKEN = "rtm_" + "a".repeat(48),
  OLD_TOKEN = "PRIVATE-REGISTRATION-FIXTURE";
let owner: string,
  actor: string,
  customer: string,
  groupId: string,
  entitlement: string,
  ownEntitlement: string,
  tokenId: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "registration-rotation-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        parentUserId: accountOwnerId,
        userType: accountOwnerId ? "ram_user" : "root",
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const request = (body?: { token: string }) =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "client:Fake" },
    body,
    secure: true,
    ip: "192.0.2.42",
  }) as unknown as TypedRequest;
const prepare = () => authority.prepare("RotateRegistrationToken", actor, request(), entitlement);
const input = () => ({ token: NEW_TOKEN, label: "next", expiresAt: null });
async function deny(action: string, resource: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: "Deny", Action: "quyan:remote_terminal:" + action, Resource: resource },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "rotation-deny-" + randomUUID(),
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
  customer = await user();
  groupId = (
    await prisma.group.create({
      data: {
        username: "rotation-global-" + randomUUID(),
        name: "Fixture registration manager",
        accountOwnerId: null,
        permissions: [Permission.REMOTE_TERMINAL_REGISTRATION_TOKEN_WRITE],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  const create = async (userId: string) =>
    (
      await prisma.remoteTerminalUserEntitlement.create({
        data: {
          userId,
          name: "fixture entitlement",
          startAt: new Date("2026-01-01"),
          endAt: new Date("2027-01-01"),
          deviceLimit: 2,
          terminalLimit: 1,
        },
      })
    ).id;
  entitlement = await create(customer);
  ownEntitlement = await create(actor);
  tokenId = (
    await prisma.remoteTerminalEntitlementToken.create({
      data: { entitlementId: entitlement, token: OLD_TOKEN + randomUUID(), label: "old", lastUsedAt: new Date() },
    })
  ).id;
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
});
describe("registration token transaction authority", () => {
  it("rotates through the real management method without reading the old credential", async () => {
    const hydrate = vi.spyOn(RemoteTerminalProductRepository.getInstance(), "findEntitlementById");
    const result = await RemoteTerminalProductService.getInstance().rotateRegistrationToken(
      entitlement,
      {},
      actor,
      request(),
    );
    expect(result.token).toMatch(/^rtm_[0-9a-f]{48}$/);
    expect(result.id).toBe(tokenId);
    expect(result.label).toBe("old");
    expect(result.lastUsedAt).toBeUndefined();
    expect(hydrate).not.toHaveBeenCalled();
    expect((await prisma.remoteTerminalEntitlementToken.findUnique({ where: { id: tokenId } }))?.token).toBe(
      result.token,
    );
  });
  it("keeps old and new credentials, JWTs and policy documents out of mutation audit context", async () => {
    const log = vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockResolvedValue(undefined);
    const req = request({ token: "PRIVATE-BODY-FIXTURE" });
    req.headers.authorization = "Bearer PRIVATE-JWT-FIXTURE";
    const result = await RemoteTerminalProductService.getInstance().rotateRegistrationToken(
      entitlement,
      {},
      actor,
      req,
    );
    expect(log).toHaveBeenCalled();
    const serialized = JSON.stringify({ logs: log.mock.calls, decisions: req.iamDecisions });
    for (const secret of [OLD_TOKEN, result.token!, "PRIVATE-JWT-FIXTURE", "PRIVATE-BODY-FIXTURE", '"Statement"'])
      expect(serialized.includes(secret)).toBe(false);
  });
  it("preserves personal credential rotation without requiring administrator permission", async () => {
    await prisma.user.update({ where: { id: actor }, data: { groupId: null } });
    const result = await RemoteTerminalProductService.getInstance().rotateCurrentUserRegistrationToken(
      actor,
      ownEntitlement,
      { label: " mine " },
      request(),
    );
    expect(result.token).toMatch(/^rtm_[0-9a-f]{48}$/);
    expect(result.label).toBe("mine");
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses cross-user personal rotation regardless of management eligibility", async () => {
    await expect(
      RemoteTerminalProductService.getInstance().rotateCurrentUserRegistrationToken(actor, entitlement, {}, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["parent", "token"])(
    "refuses management denial on the %s resource without overwriting a token",
    async (kind) => {
      const old = await prisma.remoteTerminalEntitlementToken.findUniqueOrThrow({ where: { id: tokenId } });
      await deny(
        "RotateRegistrationToken",
        kind === "parent"
          ? platformTerminalEntitlementArn(customer, entitlement)
          : platformTerminalRegistrationTokenArn(customer, entitlement, tokenId),
      );
      await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
      expect(
        (await prisma.remoteTerminalEntitlementToken.findUnique({ where: { id: tokenId } }))?.token === old.token,
      ).toBe(true);
    },
  );
  it("refuses personal token denial and rolls back first-time credential creation", async () => {
    await deny(
      "RotateMyRegistrationToken",
      remoteTerminalProductRegistrationTokenArn(owner, actor, ownEntitlement, "placeholder").replace(
        "/placeholder",
        "/*",
      ),
    );
    await expect(
      RemoteTerminalProductService.getInstance().rotateCurrentUserRegistrationToken(
        actor,
        ownEntitlement,
        {},
        request(),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.remoteTerminalEntitlementToken.count({ where: { entitlementId: ownEntitlement } })).toBe(0);
  });
  it("refuses personal parent denial before token creation", async () => {
    await deny("RotateMyRegistrationToken", remoteTerminalProductEntitlementArn(owner, actor, ownEntitlement));
    await expect(
      RemoteTerminalProductService.getInstance().rotateCurrentUserRegistrationToken(
        actor,
        ownEntitlement,
        {},
        request(),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("loads only token metadata before mutation", async () => {
    const source = await prepare();
    expect(source?.target.registrationToken?.id).toBe(tokenId);
    expect(source?.target.registrationToken).not.toHaveProperty("token");
    expect(JSON.stringify(source?.target)).not.toContain(OLD_TOKEN);
  });
  it("refuses timestamp-preserving metadata changes", async () => {
    const source = await prepare();
    await prisma.$executeRaw`UPDATE remote_terminal_entitlement_tokens SET label='concurrent-label' WHERE id=${tokenId}`;
    await expect(repository.rotate(source!.target, input(), source!.guard)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.remoteTerminalEntitlementToken.findUnique({ where: { id: tokenId } }))?.label).toBe(
      "concurrent-label",
    );
  });
  it("refuses policy revocation after preparation", async () => {
    const source = await prepare();
    await deny("RotateRegistrationToken", platformTerminalEntitlementArn(customer, entitlement));
    await expect(repository.rotate(source!.target, input(), source!.guard)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rolls back replacement when final credential admission fails", async () => {
    const source = await prepare(),
      old = await prisma.remoteTerminalEntitlementToken.findUniqueOrThrow({ where: { id: tokenId } }),
      recheck = source!.guard.recheckToken;
    let checks = 0;
    source!.guard.recheckToken = async (id) => {
      await recheck(id);
      if (++checks === 2) throw iamAccountDenied();
    };
    await expect(repository.rotate(source!.target, input(), source!.guard)).rejects.toMatchObject({ statusCode: 403 });
    expect(checks).toBe(2);
    expect(
      (await prisma.remoteTerminalEntitlementToken.findUnique({ where: { id: tokenId } }))?.token === old.token,
    ).toBe(true);
  });
  it("refuses stale concurrent rotation sources", async () => {
    const [first, second] = await Promise.all([prepare(), prepare()]);
    await repository.rotate(first!.target, input(), first!.guard);
    await expect(
      repository.rotate(second!.target, { ...input(), token: "rtm_" + "b".repeat(48) }, second!.guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(
      (await prisma.remoteTerminalEntitlementToken.findUnique({ where: { id: tokenId } }))?.token === NEW_TOKEN,
    ).toBe(true);
  });
  it("retains no-device token unavailability and rejects operation relabeling", async () => {
    await prisma.remoteTerminalUserEntitlement.update({ where: { id: entitlement }, data: { deviceLimit: 0 } });
    let source = await prepare();
    await expect(repository.rotate(source!.target, input(), source!.guard)).rejects.toMatchObject({
      statusCode: 400,
      messageKey: "remoteTerminalProduct.registrationTokenUnavailable",
    });
    source = await prepare();
    source!.guard.operation = "RotateMyRegistrationToken";
    await expect(repository.rotate(source!.target, input(), source!.guard)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses authorization revision drift and rolls back its transaction", async () => {
    const revision = vi
      .spyOn(revisions, "readIamAuthorizationRevision")
      .mockResolvedValueOnce("before")
      .mockResolvedValueOnce("changed");
    const before = await prisma.remoteTerminalEntitlementToken.findUnique({ where: { entitlementId: entitlement } });
    await expect(
      RemoteTerminalProductService.getInstance().rotateRegistrationToken(entitlement, {}, actor, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.remoteTerminalEntitlementToken.findUnique({ where: { entitlementId: entitlement } })).toEqual(
      before,
    );
    expect(revision).toHaveBeenCalledTimes(2);
  });
});
