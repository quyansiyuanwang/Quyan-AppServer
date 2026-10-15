import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../../src/config/database";
import { RelayTokenRepository } from "../../../src/store/relay/relay-token.repository";
import { RelayTokenUpdateRepository } from "../../../src/store/relay/relay-token-update.repository";
import { hashPassword } from "../../../src/util/crypto";

describe("RelayTokenRepository", () => {
  const repository = RelayTokenRepository.getInstance();
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  let groupId = "";
  let userId = "";
  let primaryChannelId = "";
  let secondaryChannelId = "";
  const createdTokenIds: string[] = [];

  beforeAll(async () => {
    groupId = (
      await prisma.group.create({
        data: {
          username: `relay_repo_group_${suffix}`,
          name: "Relay Repo Test Group",
          level: 1,
          permissions: JSON.stringify([]),
        },
      })
    ).id;

    userId = (
      await prisma.user.create({
        data: {
          username: `relay_repo_user_${suffix}`,
          password: hashPassword("relay_repo_password"),
          name: "Relay Repo Test User",
          email: `relay_repo_${suffix}@test.com`,
          groupId,
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;

    primaryChannelId = (
      await prisma.relayChannel.create({
        data: {
          name: `relay_repo_primary_${suffix}`,
          openaiUpstreamUrl: "https://example.com/v1",
          openaiUpstreamApiKey: "test-primary-key",
          allowedFormats: "openai",
          multiplier: 1,
        },
      })
    ).id;

    secondaryChannelId = (
      await prisma.relayChannel.create({
        data: {
          name: `relay_repo_secondary_${suffix}`,
          openaiUpstreamUrl: "https://example.com/v1",
          openaiUpstreamApiKey: "test-secondary-key",
          allowedFormats: "openai",
          multiplier: 1,
        },
      })
    ).id;
  });

  afterEach(async () => {
    if (createdTokenIds.length === 0) return;

    await prisma.relayTokenMemberConfig.deleteMany({ where: { parentTokenId: { in: createdTokenIds } } });
    await prisma.relayToken.deleteMany({
      where: { id: { in: createdTokenIds.splice(0, createdTokenIds.length) } },
    });
  });

  afterAll(async () => {
    await prisma.relayChannel.deleteMany({
      where: { id: { in: [primaryChannelId, secondaryChannelId].filter(Boolean) } },
    });

    await prisma.user.deleteMany({
      where: { id: userId || undefined },
    });

    await prisma.group.deleteMany({
      where: { id: groupId || undefined },
    });
  });

  it("creates failover config on token update when it does not exist", async () => {
    const relayToken = await repository.create({
      userId,
      token: `rlt_${randomUUID().replace(/-/g, "")}`,
      name: "repo-create-failover",
      channelId: primaryChannelId,
    });
    createdTokenIds.push(relayToken.id);

    await expect(
      repository.update(relayToken.id, {
        failoverConfig: {
          enabled: true,
          maxRetries: 2,
          retryStatusCodes: ["401", "503"],
          maxAcceptedChannelMultiplier: 2.5,
        },
      }),
    ).resolves.toBeTruthy();

    const updatedToken = await repository.findByIdWithRelations(relayToken.id);

    expect(updatedToken?.failoverConfig).toMatchObject({
      enabled: true,
      maxRetries: 2,
      retryStatusCodes: ["401", "503"],
    });
    expect(Number(updatedToken?.failoverConfig?.maxAcceptedChannelMultiplier)).toBe(2.5);
  });

  it("updates existing failover config without violating the required relation", async () => {
    const relayToken = await repository.create({
      userId,
      token: `rlt_${randomUUID().replace(/-/g, "")}`,
      name: "repo-update-failover",
      channelId: primaryChannelId,
      failoverConfig: {
        enabled: true,
        maxRetries: 1,
        retryStatusCodes: ["503"],
        maxAcceptedChannelMultiplier: 4,
      },
      channelConfigs: [
        { channelId: primaryChannelId, priority: 0 },
        { channelId: secondaryChannelId, priority: 1 },
      ],
    });
    createdTokenIds.push(relayToken.id);

    await expect(
      repository.update(relayToken.id, {
        name: "repo-update-failover-patched",
        failoverConfig: {
          enabled: true,
          maxRetries: 3,
          retryStatusCodes: ["4xx", "503"],
          maxAcceptedChannelMultiplier: 1.75,
        },
      }),
    ).resolves.toBeTruthy();

    const updatedToken = await repository.findByIdWithRelations(relayToken.id);

    expect(updatedToken).toMatchObject({
      name: "repo-update-failover-patched",
    });
    expect(updatedToken?.failoverConfig).toMatchObject({
      enabled: true,
      maxRetries: 3,
      retryStatusCodes: ["4xx", "503"],
    });
    expect(Number(updatedToken?.failoverConfig?.maxAcceptedChannelMultiplier)).toBe(1.75);
    expect(updatedToken?.channelConfigs.map((config) => config.channelId)).toEqual([
      primaryChannelId,
      secondaryChannelId,
    ]);
  });
  it("atomically stores composite members, protects ancestors and preserves secrets on mode changes", async () => {
    const create = async (name: string, members?: string[]) => {
      const token = await repository.create({
        userId,
        name,
        token: `test_${randomUUID()}`,
        routingMode: members ? "composite" : "ordered",
        channelId: members ? undefined : primaryChannelId,
        memberTokenConfigs: members?.map((tokenId, priority) => ({ tokenId, priority, enabled: true })),
      });
      createdTokenIds.push(token.id);
      return token;
    };
    const leaf = await create("leaf");
    const child = await create("child", [leaf.id]);
    const root = await create("root", [child.id]);
    expect(root.memberTokenConfigs[0].memberToken).not.toHaveProperty("token");
    await expect(
      repository.update(child.id, { memberTokenConfigs: [{ tokenId: root.id, priority: 0, enabled: true }] }),
    ).rejects.toThrow();
    expect((await repository.findByIdWithRelations(child.id))!.memberTokenConfigs[0].tokenId).toBe(leaf.id);
    await repository.update(root.id, {
      routingMode: "ordered",
      channelId: primaryChannelId,
      channelConfigs: [{ channelId: primaryChannelId, priority: 0 }],
    });
    const changed = (await repository.findByIdWithRelations(root.id))!;
    expect(changed.token).toBe(root.token);
    expect(changed.memberTokenConfigs).toHaveLength(0);
  });

  describe("caller-owned token update transactions", () => {
    const writer = RelayTokenUpdateRepository.getInstance();
    const state = (id: string) =>
      prisma.relayToken.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          name: true,
          channelId: true,
          routingMode: true,
          updateTime: true,
          token: true,
          legacyToken: true,
          isCustomKey: true,
          expiresAt: true,
          quotaLimit: true,
          allowedModels: true,
          modelMapping: true,
          requestFormatTransforms: true,
          normalizerConfig: true,
          streamConfig: true,
          contentSafetyConfig: true,
          automaticProxyPoolChannelId: true,
          blockedAutomaticProxyPoolChannelIds: true,
          channelConfigs: { orderBy: { priority: "asc" }, select: { channelId: true, priority: true } },
          quotaWindows: {
            orderBy: { quotaWindowHours: "asc" },
            select: { quotaLimit: true, quotaUnit: true, quotaWindowHours: true },
          },
          memberTokenConfigs: {
            orderBy: { priority: "asc" },
            select: { tokenId: true, priority: true, enabled: true },
          },
          failoverConfig: { select: { enabled: true, maxRetries: true, retryStatusCodes: true } },
        },
      });
    const create = async (name: string) => {
      const token = await repository.create({
        userId,
        name,
        token: `test_${randomUUID()}`,
        channelId: primaryChannelId,
        channelConfigs: [{ channelId: primaryChannelId, priority: 0 }],
        quotaWindows: [{ quotaLimit: 10, quotaUnit: "request", quotaWindowHours: 1 }],
        failoverConfig: { enabled: false, maxRetries: 2, retryStatusCodes: ["503"] },
      });
      createdTokenIds.push(token.id);
      return token;
    };
    it("does not commit nested writes before caller response and authority checks finish", async () => {
      const token = await create("rollback-main-and-relations");
      const member = await create("rollback-member");
      const original = await state(token.id);
      const denied = new Error("simulated final authority or response denial");
      await expect(
        prisma.$transaction(async (tx) => {
          await writer.apply(tx, token.id, {
            name: "must-roll-back",
            token: `test_${randomUUID()}`,
            legacyToken: "fixture-alias",
            isCustomKey: true,
            routingMode: "composite",
            channelId: null,
            channelConfigs: [],
            memberTokenConfigs: [{ tokenId: member.id, priority: 0, enabled: true }],
            expiresAt: new Date("2030-01-01T00:00:00Z"),
            quotaLimit: 7,
            quotaWindows: [{ quotaLimit: 3, quotaUnit: "request", quotaWindowHours: 2 }],
            modelMapping: { from: "to" },
            requestFormatTransforms: [],
            automaticProxyPoolChannelId: null,
            blockedAutomaticProxyPoolChannelIds: [],
            failoverConfig: { enabled: true, maxRetries: 3, retryStatusCodes: ["429"] },
          });
          expect(await tx.relayTokenMemberConfig.count({ where: { parentTokenId: token.id } })).toBe(1);
          expect(await tx.relayTokenChannelConfig.count({ where: { relayTokenId: token.id } })).toBe(0);
          expect(
            Number((await tx.relayTokenQuotaWindow.findFirstOrThrow({ where: { relayTokenId: token.id } })).quotaLimit),
          ).toBe(3);
          throw denied;
        }),
      ).rejects.toBe(denied);
      expect(await state(token.id)).toEqual(original);
    });
    it("applies all relations in the supplied transaction without hydrating a credential-bearing result", async () => {
      const token = await create("commit-main-and-relations");
      const member = await create("commit-member");
      const transactions = vi.spyOn(prisma, "$transaction");
      try {
        await prisma.$transaction(async (tx) => {
          const updates = vi.spyOn(tx.relayToken, "update");
          try {
            expect(
              await writer.apply(tx, token.id, {
                name: "committed",
                routingMode: "composite",
                channelId: null,
                channelConfigs: [],
                memberTokenConfigs: [{ tokenId: member.id, priority: 0, enabled: true }],
                quotaWindows: [],
                failoverConfig: { enabled: true, maxRetries: 4 },
              }),
            ).toBeUndefined();
            expect(updates.mock.calls.length).toBeGreaterThan(0);
            for (const [args] of updates.mock.calls) {
              expect(args.select).toBeDefined();
              expect(args.select).not.toHaveProperty("token");
              expect(args.select).not.toHaveProperty("legacyToken");
            }
          } finally {
            updates.mockRestore();
          }
        });
        expect(transactions).toHaveBeenCalledTimes(1);
      } finally {
        transactions.mockRestore();
      }
      const updated = await state(token.id);
      expect(updated).toMatchObject({
        name: "committed",
        routingMode: "composite",
        channelId: null,
        memberTokenConfigs: [{ tokenId: member.id, priority: 0, enabled: true }],
        channelConfigs: [],
        quotaWindows: [],
        failoverConfig: { enabled: true, maxRetries: 4 },
      });
      expect(updated.token).toBe(token.token);
      expect(updated.legacyToken).toBe(token.legacyToken);
    });
    it("rolls back scalar and failover writes when a later relation write fails", async () => {
      const token = await create("rollback-on-channel-constraint");
      const original = await state(token.id);
      await expect(
        repository.update(token.id, {
          name: "invalid-write",
          channelId: secondaryChannelId,
          channelConfigs: [
            { channelId: secondaryChannelId, priority: 0 },
            { channelId: secondaryChannelId, priority: 1 },
          ],
          failoverConfig: { enabled: true, maxRetries: 7 },
        }),
      ).rejects.toThrow();
      expect(await state(token.id)).toEqual(original);
    });
    it("preserves omitted relations and supports explicit JSON and quota clearing", async () => {
      const token = await create("clear-json-preserve-relations");
      const original = await state(token.id);
      const updated = await repository.update(token.id, {
        modelMapping: { a: "b" },
        requestFormatTransforms: [],
        quotaLimit: 9,
      });
      expect(updated.token).toBe(token.token);
      expect(updated.modelMapping).toEqual({ a: "b" });
      const written = await state(token.id);
      expect(written.channelConfigs).toEqual(original.channelConfigs);
      expect(written.quotaWindows).toEqual(original.quotaWindows);
      expect(written.failoverConfig).toEqual(original.failoverConfig);
      await prisma.$transaction((tx) =>
        writer.apply(tx, token.id, {
          modelMapping: null,
          requestFormatTransforms: null,
          normalizerConfig: null,
          contentSafetyConfig: null,
          streamConfig: null,
          quotaWindows: [],
          quotaLimit: null,
        }),
      );
      expect(await state(token.id)).toMatchObject({
        modelMapping: null,
        requestFormatTransforms: null,
        normalizerConfig: null,
        contentSafetyConfig: null,
        streamConfig: null,
        quotaWindows: [],
        quotaLimit: null,
        channelConfigs: original.channelConfigs,
      });
    });
  });
});
