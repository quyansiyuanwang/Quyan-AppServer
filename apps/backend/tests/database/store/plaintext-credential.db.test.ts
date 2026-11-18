import { randomUUID } from "node:crypto";
import { getCredentialPrefix, toLegacyCredential } from "@quyan/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { OJQAService } from "@/services/oj-submitter/oj-qa.service";
import { RelayTokenService } from "@/services/relay/relay-token.service";
import { AccessKeyService } from "@/services/users/accesskey.service";
import { AccessKeyRepository } from "@/store/users/accesskey.repository";
import { OJAPIKeyRepository } from "@/store/oj-submitter/oj-apikey.repository";
import { RelayTokenRepository } from "@/store/relay/relay-token.repository";
import { createSupportRelayAuthorization, resolveSupportRelayClientIp } from "@/util/support-relay-authorization";

type FixtureOptions = { status?: number; expiresAt?: Date };
let userId: string;
beforeAll(async () => {
  ({ id: userId } = await prisma.user.create({
    data: { username: `prefix-${randomUUID()}`, password: "fixture", permissionAdds: [], permissionRemoves: [] },
  }));
});

it("keeps Support Relay signatures bound to the supplied spelling and preserves the IP allowlist", async () => {
  const token = `sk-rlt-fixture-${randomUUID()}`;
  const alias = toLegacyCredential(token, "relayToken");
  const row = await prisma.relayToken.create({ data: { userId, token, ipWhitelist: "198.51.100.23" } });
  const service = new RelayTokenService();
  const now = Date.now();
  for (const [spell, other] of [
    [token, alias],
    [alias, token],
  ]) {
    const headers = createSupportRelayAuthorization(spell!, "198.51.100.23", now);
    const trustedIp = resolveSupportRelayClientIp(headers, spell!, now);
    await expect(service.validateToken(spell!, undefined, trustedIp)).resolves.toMatchObject({ id: row.id });
    expect(resolveSupportRelayClientIp(headers, other!, now)).toBeUndefined();
    await expect(service.validateToken(spell!, undefined, "198.51.100.42")).rejects.toMatchObject({ statusCode: 403 });
  }
});

const cases = [
  {
    type: "relayToken",
    seed: (token: string, legacyToken?: string, options?: FixtureOptions) =>
      prisma.relayToken.create({ data: { userId, token, legacyToken, ...options } }),
    authenticate: async (token: string) => (await new RelayTokenService().validateToken(token)).id,
    issue: (token: string) => RelayTokenRepository.getInstance().create({ token, userId }),
  },
  {
    type: "accessKey",
    seed: (key: string, legacyKey?: string, options?: FixtureOptions) =>
      prisma.accessKey.create({ data: { userId, key, legacyKey, ...options } }),
    authenticate: async (key: string) => (await new AccessKeyService().validateKey(key)).id,
    issue: (key: string) => AccessKeyRepository.getInstance().create({ key, userId }),
  },
  {
    type: "ojApiKey",
    seed: (key: string, legacyKey?: string, options?: FixtureOptions) =>
      prisma.oJAPIKey.create({ data: { userId, key, legacyKey, name: "fixture", ...options } }),
    authenticate: async (key: string) => (await OJQAService.getInstance().validateAPIKey(key)).keyId,
    issue: (key: string) => OJAPIKeyRepository.getInstance().create({ key, userId, name: "fixture" }),
  },
] as const;

describe.each(cases)("$type prefix compatibility", ({ type, seed, authenticate, issue }) => {
  const pair = () => {
    const suffix = `FiXtUrE-${randomUUID()}`;
    return {
      canonical: getCredentialPrefix(type) + suffix,
      legacy: getCredentialPrefix(type, "legacy") + suffix,
      wrongCase: getCredentialPrefix(type) + suffix.toLowerCase(),
    };
  };

  it.each(["legacy", "migrated", "canonical"] as const)("accepts both spellings for %s storage", async (stored) => {
    const { canonical, legacy, wrongCase } = pair();
    const row = await seed(stored === "legacy" ? legacy : canonical, stored === "migrated" ? legacy : undefined);
    await expect(authenticate(canonical)).resolves.toBe(row.id);
    await expect(authenticate(legacy)).resolves.toBe(row.id);
    await expect(authenticate(wrongCase)).rejects.toBeDefined();
    await expect(authenticate(getCredentialPrefix(type))).rejects.toBeDefined();
    await expect(authenticate(`sk-dpk-${randomUUID()}`)).rejects.toBeDefined();
  });

  it("does not issue a new record over a legacy-only credential", async () => {
    const { canonical, legacy } = pair();
    await seed(legacy);
    await expect(issue(canonical)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("rejects a pair owned by multiple records, even when only one is enabled", async () => {
    const { canonical, legacy } = pair();
    await seed(canonical);
    await seed(legacy, undefined, { status: 0 });
    for (const key of [canonical, legacy]) await expect(authenticate(key)).rejects.toBeDefined();
  });

  it.each([{ status: 0 }, { status: -1 }, { expiresAt: new Date(0) }])(
    "preserves status and expiry checks (%j)",
    async (options) => {
      const { canonical, legacy } = pair();
      await seed(canonical, undefined, options);
      for (const key of [canonical, legacy]) await expect(authenticate(key)).rejects.toBeDefined();
    },
  );
});
