import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INSTALL_TOKEN_POLICY,
  issueIamInstallToken,
  issueInstallToken,
  verifyInstallToken,
  type IamInstallTokenGrant,
} from "@/modules/remote-terminal/install-token";
const SECRET = "fixture-only-install-signature-".repeat(4);
const NOW = new Date("2026-10-15T00:00:00Z");
const grant: IamInstallTokenGrant = {
  principal: { subjectUserId: "child", principalUserId: "child", accountOwnerId: "owner", subjectType: "sub_user" },
  policyFingerprint: "a".repeat(64),
  userFingerprint: "b".repeat(64),
  targetFingerprint: "c".repeat(64),
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());
function signed(payload: object) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const hmac = createHmac("sha256", SECRET)
    .update("v2." + encoded)
    .digest("hex");
  return "rtm-t.v2." + encoded + "." + hmac;
}
describe("versioned install token codec", () => {
  it("retains v1 decoding and authenticates v2 identity and revision hashes", () => {
    const legacy = issueInstallToken("entitlement", SECRET),
      native = issueIamInstallToken("entitlement", SECRET, grant);
    expect(verifyInstallToken(legacy.token, SECRET)).toEqual({ entitlementId: "entitlement" });
    expect(verifyInstallToken(native.token, SECRET)).toMatchObject({
      entitlementId: "entitlement",
      capability: { version: 2, grant },
    });
    expect(native.expiresAt).toBe(new Date(NOW.getTime() + INSTALL_TOKEN_POLICY.ttlSeconds * 1000).toISOString());
    expect(verifyInstallToken(native.token, SECRET + "wrong")).toBeNull();
  });
  it("expires at the declared bound and rejects timestamps too far in the future", () => {
    const token = issueIamInstallToken("entitlement", SECRET, grant).token;
    vi.setSystemTime(new Date(NOW.getTime() + INSTALL_TOKEN_POLICY.ttlSeconds * 1000));
    expect(verifyInstallToken(token, SECRET)).toBeNull();
    vi.setSystemTime(new Date(NOW.getTime() - (INSTALL_TOKEN_POLICY.clockSkewSeconds + 1) * 1000));
    expect(verifyInstallToken(token, SECRET)).toBeNull();
  });
  it("rejects tampering, version changes and noncanonical encodings before trusting metadata", () => {
    const token = issueIamInstallToken("entitlement", SECRET, grant).token;
    expect(verifyInstallToken(token.replace("v2.", "v3."), SECRET)).toBeNull();
    expect(verifyInstallToken(token.slice(0, -1) + (token.endsWith("a") ? "b" : "a"), SECRET)).toBeNull();
    const parts = token.split(".");
    parts[2] += "=";
    expect(verifyInstallToken(parts.join("."), SECRET)).toBeNull();
    expect(verifyInstallToken("rtm-t." + "a".repeat(INSTALL_TOKEN_POLICY.maxTokenLength), SECRET)).toBeNull();
  });
  it.each([
    { grant: { ...grant, principal: { ...grant.principal, subjectUserId: "other" } } },
    { grant: { ...grant, principal: { ...grant.principal, subjectType: "root" } } },
    { grant: { ...grant, principal: { ...grant.principal, subjectType: "assumed_role" } } },
    { grant: { ...grant, principal: { ...grant.principal, roleSessionId: "session" } } },
    { grant: { ...grant, principal: { ...grant.principal, subjectType: "access_key" } } },
    { grant: { ...grant, accessKeyId: "key" } },
    { grant: { ...grant, policyFingerprint: "not-a-hash" } },
    { grant: { ...grant, secret: "unexpected" } },
    { version: 3 },
    { entitlementId: "../foreign" },
    { issuedAt: -1 },
    { ignored: true },
  ])("rejects signed but invalid or ambiguous grants %#", (fields) => {
    expect(
      verifyInstallToken(
        signed({ version: 2, entitlementId: "entitlement", issuedAt: NOW.getTime() / 1000, grant, ...fields }),
        SECRET,
      ),
    ).toBeNull();
  });
  it("retains explicit role-session and AccessKey identity without credential values", () => {
    for (const identity of [
      {
        ...grant,
        principal: {
          ...grant.principal,
          subjectType: "assumed_role" as const,
          assumedRoleId: "role",
          roleSessionId: "session",
        },
      },
      { ...grant, principal: { ...grant.principal, subjectType: "access_key" as const }, accessKeyId: "key" },
    ])
      expect(
        verifyInstallToken(issueIamInstallToken("entitlement", SECRET, identity).token, SECRET)?.capability?.grant,
      ).toEqual(identity);
    expect(() => issueIamInstallToken("entitlement", "too-short", grant)).toThrow();
  });
  it("rejects partial integer time and malformed hexadecimal legacy signatures", () => {
    const encodedId = Buffer.from("entitlement").toString("base64url"),
      encodedTime = Buffer.from("123junk").toString("base64url");
    expect(verifyInstallToken(`rtm-t.${encodedId}.${encodedTime}.${"a".repeat(64)}`, SECRET)).toBeNull();
    const legacy = issueInstallToken("entitlement", SECRET).token;
    expect(verifyInstallToken(legacy.slice(0, -64) + "z".repeat(64), SECRET)).toBeNull();
  });
});
