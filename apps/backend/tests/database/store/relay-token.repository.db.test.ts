import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../../src/config/database";
import { RelayTokenRepository } from "../../../src/store/relay/relay-token.repository";
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
});
