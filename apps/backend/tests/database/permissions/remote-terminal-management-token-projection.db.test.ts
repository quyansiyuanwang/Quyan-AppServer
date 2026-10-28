import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Permission } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RemoteTerminalProductService } from "@/services/remote-terminal/remote-terminal-product.service";
const mode = env.security.iamAuthorizationMode,
  service = RemoteTerminalProductService.getInstance();
let owner: string, other: string, entitlementId: string, secret: string, groupId: string;
const request = () =>
  ({
    user: { userId: owner },
    authContext: { principalUserId: owner, accountOwnerId: owner, subjectType: "root" },
    headers: {},
    secure: true,
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
beforeEach(async () => {
  env.security.iamAuthorizationMode = "legacy";
  owner = (
    await prisma.user.create({
      data: {
        username: "token-projection-owner-" + randomUUID(),
        password: "fixture-only",
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
  other = (
    await prisma.user.create({
      data: {
        username: "token-projection-other-" + randomUUID(),
        password: "fixture-only",
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
  groupId = (
    await prisma.group.create({
      data: {
        username: "token-projection-management-" + randomUUID(),
        accountOwnerId: null,
        permissions: [Permission.REMOTE_TERMINAL_ASSIGNMENT_READ],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: owner }, data: { groupId, userType: "root" } });
  secret = "fixture-only-registration-secret-" + randomUUID();
  const data = {
    name: "Fixture entitlement",
    startAt: new Date(Date.now() - 60000),
    endAt: new Date(Date.now() + 3600000),
    deviceLimit: 1,
    terminalLimit: 1,
  };
  entitlementId = (await prisma.remoteTerminalUserEntitlement.create({ data: { ...data, userId: owner } })).id;
  await prisma.remoteTerminalEntitlementToken.create({
    data: { entitlementId, token: secret, label: "Fixture token" },
  });
  const otherEntitlement = await prisma.remoteTerminalUserEntitlement.create({ data: { ...data, userId: other } });
  await prisma.remoteTerminalEntitlementToken.create({
    data: { entitlementId: otherEntitlement.id, token: "fixture-only-other-secret-" + randomUUID() },
  });
});
afterEach(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [owner, other].filter(Boolean) } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
  env.security.iamAuthorizationMode = mode;
});
describe("terminal registration credential response boundary", () => {
  it.each(["legacy", "shadow", "enforce"] as const)(
    "masks credentials in %s management list projections",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      const result = await service.listEntitlements(1, 20, undefined, undefined, undefined, request());
      expect(result.total).toBe(2);
      expect(result.records.every((row) => row.registrationToken && !("token" in row.registrationToken))).toBe(true);
      expect(result.records.find((row) => row.id === entitlementId)?.registrationToken).toMatchObject({
        label: "Fixture token",
      });
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(result.records.every((row) => !!row.registrationToken?.maskedToken)).toBe(true);
    },
  );
  it("cannot expose the credential by supplying the same user filter as the personal endpoint", async () => {
    const result = await service.listEntitlements(1, 20, owner, undefined, undefined, request());
    expect(result.total).toBe(1);
    expect(result.records[0]?.registrationToken).not.toHaveProperty("token");
  });
  it("preserves owner installation credentials without returning another user's entitlement", async () => {
    const result = await service.listCurrentUserEntitlements(owner, 1, 20);
    expect(result.total).toBe(1);
    expect(result.records[0]?.id).toBe(entitlementId);
    expect(result.records[0]?.registrationToken?.token).toBe(secret);
    expect(result.records.some((row) => row.userId === other)).toBe(false);
  });
});
