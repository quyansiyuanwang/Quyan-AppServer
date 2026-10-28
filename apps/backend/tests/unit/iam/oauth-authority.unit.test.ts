import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ oAuthAccessToken: { findUnique: vi.fn() } }));
vi.mock("@/config/database", () => ({ prisma: db }));
import { Permission, type IamPrincipal } from "@quyan/shared";
import { captureIamOAuthRevision } from "@/store/users/iam-oauth-authority";
const principal: IamPrincipal = {
  subjectUserId: "actor",
  principalUserId: "actor",
  accountOwnerId: "owner",
  subjectType: "sub_user",
};
const binding = { id: "oauth", clientId: "client" };
const valid = () => ({
  userId: "actor",
  oauthClientId: "client",
  status: 1,
  revokedAt: null as Date | null,
  expiresAt: new Date(Date.now() + 60000),
  scopes: [Permission.RELAY_TOKEN_READ] as string[],
  oauthClient: { status: 1, reviewStatus: "approved", scopes: [Permission.RELAY_TOKEN_READ] as string[] },
});
beforeEach(() => {
  vi.resetAllMocks();
  db.oAuthAccessToken.findUnique.mockResolvedValue(valid());
});
describe("persisted non-secret OAuth authority", () => {
  it("does not query OAuth storage without an OAuth binding", async () => {
    expect(await captureIamOAuthRevision(principal, undefined, [Permission.RELAY_TOKEN_READ])).toBeUndefined();
    expect(db.oAuthAccessToken.findUnique).not.toHaveBeenCalled();
  });
  it("accepts original and canonical scope aliases on both token and client", async () => {
    expect(await captureIamOAuthRevision(principal, binding, ["relay:usage:read"])).toContain('"tokenId":"oauth"');
    const token = valid();
    token.scopes = ["relay:usage:read"];
    token.oauthClient.scopes = ["relay:usage:read"];
    db.oAuthAccessToken.findUnique.mockResolvedValue(token);
    expect(await captureIamOAuthRevision(principal, binding, [Permission.RELAY_TOKEN_READ])).toContain(
      '"clientId":"client"',
    );
  });
  it.each([
    { userId: "foreign" },
    { oauthClientId: "other" },
    { status: 0 },
    { revokedAt: new Date() },
    { expiresAt: new Date(0) },
    { scopes: [] },
  ])("rejects stale or mismatched token authority %j", async (patch) => {
    db.oAuthAccessToken.findUnique.mockResolvedValue({ ...valid(), ...patch });
    await expect(captureIamOAuthRevision(principal, binding, [Permission.RELAY_TOKEN_READ])).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it.each([{ status: 0 }, { reviewStatus: "pending" }, { scopes: [] }])(
    "rechecks current application authority %j",
    async (patch) => {
      const token = valid();
      token.oauthClient = { ...token.oauthClient, ...patch };
      db.oAuthAccessToken.findUnique.mockResolvedValue(token);
      await expect(captureIamOAuthRevision(principal, binding, [Permission.RELAY_TOKEN_READ])).rejects.toMatchObject({
        statusCode: 403,
      });
    },
  );
  it("requires every declared scope on both persisted records", async () => {
    await expect(
      captureIamOAuthRevision(principal, binding, [Permission.RELAY_TOKEN_READ, Permission.RELAY_TOKEN_UPDATE]),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails closed for missing records and invalid binding IDs", async () => {
    db.oAuthAccessToken.findUnique.mockResolvedValue(null);
    await expect(captureIamOAuthRevision(principal, binding, [Permission.RELAY_TOKEN_READ])).rejects.toMatchObject({
      statusCode: 403,
    });
    db.oAuthAccessToken.findUnique.mockClear();
    await expect(
      captureIamOAuthRevision(principal, { ...binding, id: "*" }, [Permission.RELAY_TOKEN_READ]),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(db.oAuthAccessToken.findUnique).not.toHaveBeenCalled();
  });
  it("never selects token hashes, client secrets, or mutable usage counters", async () => {
    await captureIamOAuthRevision(principal, binding, [Permission.RELAY_TOKEN_READ]);
    expect(db.oAuthAccessToken.findUnique).toHaveBeenCalledWith({
      where: { id: "oauth" },
      select: {
        userId: true,
        oauthClientId: true,
        status: true,
        revokedAt: true,
        expiresAt: true,
        scopes: true,
        oauthClient: { select: { status: true, reviewStatus: true, scopes: true } },
      },
    });
  });
});
