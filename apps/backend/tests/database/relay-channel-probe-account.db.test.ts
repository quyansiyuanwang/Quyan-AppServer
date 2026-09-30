import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "@/config/database";
import { RelayChannelProbeRepository } from "@/store/relay/relay-channel-probe.repository";
import { RelayChannelProbeAccountRepository } from "@/store/relay/relay-channel-probe-account.repository";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { RelayChannelProbeService } from "@/services/relay/relay-channel-probe.service";
import { PermissionService } from "@/services/users/permission.service";

/** Database contract: account bindings never follow a profile template copy. */
describe("probe account target persistence", () => {
  const name = randomUUID();
  let sourceId = "";
  let targetId = "";
  let accountId = "";
  let sourceProfileId = "";
  beforeAll(async () => {
    const source = await prisma.relayChannel.create({
      data: {
        name: `probe-account-source-${name}`,
        allowedFormats: "openai",
        openaiUpstreamUrl: "https://example.com",
        openaiUpstreamApiKey: "test-key",
      },
    });
    const target = await prisma.relayChannel.create({
      data: {
        name: `probe-account-target-${name}`,
        allowedFormats: "anthropic",
        anthropicUpstreamUrl: "https://example.com",
        anthropicUpstreamApiKey: "test-key",
      },
    });
    sourceId = source.id;
    targetId = target.id;
    const account = await prisma.relayChannelProbeAccount.create({
      data: {
        name: `test-${name}`,
        tokenPath: "data.token",
        fallbackTtlSeconds: 1800,
        minLoginIntervalSeconds: 300,
        encryptedCredentials: "encrypted-only",
        credentialIv: "iv",
        credentialAuthTag: "tag",
      },
    });
    accountId = account.id;
    const profile = await prisma.relayChannelProbeProfile.create({
      data: {
        relayChannelId: sourceId,
        probeFormat: "openai",
        probeModel: "gpt-test",
        probePayload: {},
        workflow: [{ name: "balance", method: "GET", url: "https://example.com/balance", balancePath: "balance" }],
        encryptedCredentials: "source-member-secrets",
        credentialIv: "source-iv",
        credentialAuthTag: "source-tag",
      },
    });
    sourceProfileId = profile.id;
  });
  afterAll(async () => {
    await prisma.relayChannel.deleteMany({ where: { id: { in: [sourceId, targetId].filter(Boolean) } } });
    if (accountId) await prisma.relayChannelProbeAccount.delete({ where: { id: accountId } });
  });
  it("copies metadata without member credentials or account binding, preserving per-target overrides", async () => {
    const accounts = RelayChannelProbeAccountRepository.getInstance();
    await accounts.upsertTarget(sourceProfileId, sourceId, { accountId, probeFormat: "openai" });
    const source = await RelayChannelProbeRepository.getInstance().findProfileWithChannel(sourceId);
    expect(source).not.toBeNull();
    const copied = await RelayChannelProbeRepository.getInstance().copyProfile(source!, targetId, false);
    expect(copied.encryptedCredentials).toBeNull();
    expect(await accounts.findTarget(copied.id, targetId)).toBeNull();
    const configured = await accounts.upsertTarget(copied.id, targetId, {
      probeFormat: "anthropic",
      probeModel: "claude-test",
      probeGroup: "account-a",
      accountId,
    });
    expect(configured.probeFormat).toBe("anthropic");
    expect(configured.probeModel).toBe("claude-test");
    expect(await accounts.countTargets(accountId)).toBe(2);
  });
  it("rejects incompatible targets individually and accepts a physical channel's supported model", async () => {
    await prisma.relayChannel.update({
      where: { id: targetId },
      data: { allowedModels: JSON.stringify(["claude-test"]) },
    });
    const permission = vi.spyOn(PermissionService.getInstance(), "hasPermission").mockResolvedValue(true);
    const spy = vi.spyOn(RelayChannelService.getInstance(), "getChannel").mockImplementation(
      async (id) =>
        ({
          id,
          channelType: "standalone",
        }) as Awaited<ReturnType<RelayChannelService["getChannel"]>>,
    );
    try {
      const service = RelayChannelProbeService.getInstance();
      const result = await service.configureTargets(
        {
          sourceChannelId: sourceId,
          targets: [
            { channelId: targetId, probeFormat: "openai-chat-completions", probeModel: "gpt-test" },
            {
              channelId: sourceId,
              probeFormat: "openai-chat-completions",
              probeModel: "gpt-test",
              probePayload: { messages: [] },
            },
          ],
        },
        "operator",
      );
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0]?.channelId).toBe(targetId);
      expect(result.configured).toHaveLength(1);
      const valid = await service.configureTargets(
        {
          sourceChannelId: sourceId,
          targets: [
            {
              channelId: targetId,
              probeFormat: "anthropic",
              probeModel: "claude-test",
              probePayload: { messages: [] },
            },
          ],
        },
        "operator",
      );
      expect(valid.rejected).toEqual([]);
      expect(valid.configured[0]).toMatchObject({ probeFormat: "anthropic", probeModel: "claude-test" });
    } finally {
      spy.mockRestore();
      permission.mockRestore();
    }
  });
});
