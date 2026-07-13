import { beforeEach, describe, expect, it, vi } from "vitest";
import { RelayChannelService } from "../../../src/services/relay/relay-channel.service";
import { RELAY_CHANNEL_STATUS } from "../../../src/constant/relay-channel";
import { OperationType } from "../../../src/constant/operation-type";
import { NotFoundError } from "../../../src/util/errors";

describe("RelayChannelService", () => {
  const transactionClient = {} as any;
  const relayChannelRepository = {
    listActive: vi.fn(),
    listVisible: vi.fn(),
    findVisibleByName: vi.fn(),
    findActiveById: vi.fn(),
    findVisibleById: vi.fn(),
    withTransaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(transactionClient)),
    create: vi.fn(),
    updateById: vi.fn(),
    replaceMembersByChannelId: vi.fn(),
    deleteMembersByChannelId: vi.fn(),
    softDeleteAndUnassignTokens: vi.fn(),
  };
  const businessLogService = {
    logOperation: vi.fn(),
  };
  const userRepository = {
    findByIdWithGroup: vi.fn(),
  };
  const ramRoleRepository = {
    listRoleBindingsForUser: vi.fn(),
  };
  const permissionService = {
    hasAnyPermission: vi.fn(),
  };

  const RelayChannelServiceCtor = RelayChannelService as unknown as new (...args: any[]) => RelayChannelService;

  const service = new RelayChannelServiceCtor(
    relayChannelRepository,
    businessLogService,
    userRepository,
    ramRoleRepository,
    permissionService,
  );

  const now = new Date("2026-01-01T00:00:00.000Z");
  const sampleChannel = {
    id: "channel-1",
    status: RELAY_CHANNEL_STATUS.ENABLED,
    name: "Main",
    openaiUpstreamUrl: "https://upstream.example.com",
    openaiUpstreamApiKey: "openai-key",
    anthropicUpstreamUrl: null,
    anthropicUpstreamApiKey: null,
    geminiUpstreamUrl: null,
    geminiUpstreamApiKey: null,
    multiplier: 1,
    allowedFormats: "openai",
    allowedModels: null,
    addUserIdentifier: true,
    inputTokensIncludeCacheRead: false,
    createTime: now,
    updateTime: now,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    relayChannelRepository.findVisibleByName.mockResolvedValue(null);
    permissionService.hasAnyPermission.mockResolvedValue(false);
    userRepository.findByIdWithGroup.mockResolvedValue({ id: "actor-user", groupId: "group-1" });
    ramRoleRepository.listRoleBindingsForUser.mockResolvedValue([]);
  });

  it("lists active channels", async () => {
    relayChannelRepository.listActive.mockResolvedValue([sampleChannel]);

    const result = await service.listChannels("actor-user");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("channel-1");
    expect(result[0].enabled).toBe(true);
  });

  it("lists visible channels when includeDisabled is true", async () => {
    relayChannelRepository.listVisible.mockResolvedValue([{ ...sampleChannel, status: RELAY_CHANNEL_STATUS.DISABLED }]);

    const result = await service.listChannels("actor-user", true);

    expect(relayChannelRepository.listVisible).toHaveBeenCalled();
    expect(result[0].enabled).toBe(false);
  });

  it("hides private channels from non-manager users", async () => {
    relayChannelRepository.listActive.mockResolvedValue([
      { ...sampleChannel, id: "public-channel", visibilityMode: "public" },
      { ...sampleChannel, id: "private-channel", visibilityMode: "private" },
    ]);

    const result = await service.listChannels("actor-user");

    expect(result.map((item) => item.id)).toEqual(["public-channel"]);
  });

  it("shows private channels to channel managers", async () => {
    permissionService.hasAnyPermission.mockResolvedValue(true);
    relayChannelRepository.listActive.mockResolvedValue([
      { ...sampleChannel, id: "public-channel", visibilityMode: "public" },
      { ...sampleChannel, id: "private-channel", visibilityMode: "private" },
    ]);

    const result = await service.listChannels("actor-user");

    expect(result.map((item) => item.id)).toEqual(["public-channel", "private-channel"]);
  });

  it("shows whitelisted channels to matched users", async () => {
    relayChannelRepository.listActive.mockResolvedValue([
      {
        ...sampleChannel,
        id: "whitelist-channel",
        visibilityMode: "whitelist",
        visibilityConfig: {
          userIds: ["actor-user"],
        },
      },
    ]);

    const result = await service.listChannels("actor-user");

    expect(result.map((item) => item.id)).toEqual(["whitelist-channel"]);
  });

  it("throws NotFoundError when getting a missing channel", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue(null);

    await expect(service.getChannel("missing-id", "actor-user")).rejects.toThrow(NotFoundError);
  });

  it("treats inaccessible private channels as not found", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue({
      ...sampleChannel,
      id: "private-channel",
      visibilityMode: "private",
    });

    await expect(service.getChannel("private-channel", "actor-user")).rejects.toThrow(NotFoundError);
  });

  it("validates channel name on create", async () => {
    await expect(
      service.createChannel(
        {
          name: "   ",
          openaiUpstreamUrl: "https://upstream.example.com",
          openaiUpstreamApiKey: "openai-key",
        },
        "actor-user",
      ),
    ).rejects.toThrow("Channel name is required");
  });

  it("validates multiplier on create", async () => {
    await expect(
      service.createChannel(
        {
          name: "Channel",
          openaiUpstreamUrl: "https://upstream.example.com",
          openaiUpstreamApiKey: "openai-key",
          multiplier: -1,
        },
        "actor-user",
      ),
    ).rejects.toThrow("multiplier must be >= 0");
  });

  it("validates allowedFormats and allowedModels on create", async () => {
    await expect(
      service.createChannel(
        {
          name: "Channel",
          openaiUpstreamUrl: "https://upstream.example.com",
          openaiUpstreamApiKey: "openai-key",
          allowedFormats: "both",
        },
        "actor-user",
      ),
    ).rejects.toThrow("allowedFormats 'both' is deprecated");

    await expect(
      service.createChannel(
        {
          name: "Channel",
          openaiUpstreamUrl: "https://upstream.example.com",
          openaiUpstreamApiKey: "openai-key",
          allowedFormats: "invalid-format",
        },
        "actor-user",
      ),
    ).rejects.toThrow("Invalid format");

    await expect(
      service.createChannel(
        {
          name: "Channel",
          openaiUpstreamUrl: "https://upstream.example.com",
          openaiUpstreamApiKey: "openai-key",
          allowedModels: "not-json",
        },
        "actor-user",
      ),
    ).rejects.toThrow("allowedModels must be a valid JSON array");
  });

  it("requires at least one upstream URL on create", async () => {
    await expect(
      service.createChannel(
        {
          name: "Channel",
        },
        "actor-user",
      ),
    ).rejects.toThrow("At least one upstream URL");
  });

  it("creates a channel with defaults", async () => {
    relayChannelRepository.create.mockResolvedValue(sampleChannel);

    const result = await service.createChannel(
      {
        name: "Main",
        openaiUpstreamUrl: "https://upstream.example.com",
        openaiUpstreamApiKey: "openai-key",
        allowedFormats: "openai",
      },
      "actor-user",
    );

    expect(result.id).toBe("channel-1");
    expect(relayChannelRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Main",
        multiplier: 1,
        addUserIdentifier: true,
        inputTokensIncludeCacheRead: false,
      }),
      transactionClient,
    );
    expect(businessLogService.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: OperationType.RELAY_CHANNEL_CREATE,
        actorUserId: "actor-user",
        ipAddress: "unknown",
        changes: expect.objectContaining({
          openaiUpstreamApiKey: "***MASKED***",
        }),
      }),
    );
  });

  it("throws NotFoundError on update for missing channel", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue(null);

    await expect(service.updateChannel("missing-id", { name: "new-name" }, "actor-user")).rejects.toThrow(
      NotFoundError,
    );
  });

  it("updates an existing channel", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue(sampleChannel);
    relayChannelRepository.updateById.mockResolvedValue({
      ...sampleChannel,
      name: "Updated",
      multiplier: 1.5,
      allowedFormats: "openai,gemini",
    });

    const result = await service.updateChannel(
      "channel-1",
      {
        name: "Updated",
        multiplier: 1.5,
        allowedFormats: "openai,gemini",
        geminiUpstreamUrl: "https://gemini.example.com",
        geminiUpstreamApiKey: "gemini-key",
      },
      "actor-user",
    );

    expect(result.name).toBe("Updated");
    expect(relayChannelRepository.updateById).toHaveBeenCalledWith(
      "channel-1",
      expect.objectContaining({ name: "Updated", multiplier: 1.5 }),
      transactionClient,
    );
  });

  it("toggles channel status between enabled and disabled", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue(sampleChannel);
    relayChannelRepository.updateById.mockResolvedValue({
      ...sampleChannel,
      status: RELAY_CHANNEL_STATUS.DISABLED,
    });

    const result = await service.toggleChannelStatus("channel-1", "actor-user");

    expect(relayChannelRepository.updateById).toHaveBeenCalledWith("channel-1", {
      status: RELAY_CHANNEL_STATUS.DISABLED,
    });
    expect(result.enabled).toBe(false);
  });

  it("toggles channel status from disabled back to enabled", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue({
      ...sampleChannel,
      status: RELAY_CHANNEL_STATUS.DISABLED,
    });
    relayChannelRepository.updateById.mockResolvedValue(sampleChannel);

    const result = await service.toggleChannelStatus("channel-1", "actor-user");

    expect(relayChannelRepository.updateById).toHaveBeenCalledWith("channel-1", {
      status: RELAY_CHANNEL_STATUS.ENABLED,
    });
    expect(result.enabled).toBe(true);
  });

  it("throws NotFoundError when toggling a deleted channel", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue({
      ...sampleChannel,
      status: RELAY_CHANNEL_STATUS.DELETED,
    });

    await expect(service.toggleChannelStatus("channel-1", "actor-user")).rejects.toThrow(NotFoundError);
    expect(relayChannelRepository.updateById).not.toHaveBeenCalled();
  });

  it("throws NotFoundError on delete for missing channel", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue(null);

    await expect(service.deleteChannel("missing-id", "actor-user")).rejects.toThrow(NotFoundError);
  });

  it("soft deletes existing channel", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue(sampleChannel);

    await service.deleteChannel("channel-1", "actor-user");

    expect(relayChannelRepository.softDeleteAndUnassignTokens).toHaveBeenCalledWith("channel-1");
  });

  it("creates a channel with inputTokensIncludeCacheRead set to false", () => {
    // This test is now redundant since false is the default, but keeping for clarity
  });

  it("creates a channel with inputTokensIncludeCacheRead set to true", async () => {
    const channelWithCacheReadTrue = { ...sampleChannel, inputTokensIncludeCacheRead: true };
    relayChannelRepository.create.mockResolvedValue(channelWithCacheReadTrue);

    const result = await service.createChannel(
      {
        name: "Main",
        openaiUpstreamUrl: "https://upstream.example.com",
        openaiUpstreamApiKey: "openai-key",
        allowedFormats: "openai",
        inputTokensIncludeCacheRead: true,
      },
      "actor-user",
    );

    expect(result.inputTokensIncludeCacheRead).toBe(true);
    expect(relayChannelRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokensIncludeCacheRead: true,
      }),
      transactionClient,
    );
  });

  it("defaults inputTokensIncludeCacheRead to false when not specified", async () => {
    relayChannelRepository.create.mockResolvedValue(sampleChannel);

    await service.createChannel(
      {
        name: "Main",
        openaiUpstreamUrl: "https://upstream.example.com",
        openaiUpstreamApiKey: "openai-key",
        allowedFormats: "openai",
      },
      "actor-user",
    );

    expect(relayChannelRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokensIncludeCacheRead: false,
      }),
      transactionClient,
    );
  });

  it("updates inputTokensIncludeCacheRead field", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue(sampleChannel);
    const updatedChannel = { ...sampleChannel, inputTokensIncludeCacheRead: true };
    relayChannelRepository.updateById.mockResolvedValue(updatedChannel);

    const result = await service.updateChannel(
      "channel-1",
      {
        inputTokensIncludeCacheRead: true,
      },
      "actor-user",
    );

    expect(result.inputTokensIncludeCacheRead).toBe(true);
    expect(relayChannelRepository.updateById).toHaveBeenCalledWith(
      "channel-1",
      expect.objectContaining({
        inputTokensIncludeCacheRead: true,
      }),
      transactionClient,
    );
  });

  it("serializes inputTokensIncludeCacheRead correctly in toDto", async () => {
    relayChannelRepository.findVisibleById.mockResolvedValue(sampleChannel);

    const result = await service.getChannel("channel-1", "actor-user");

    expect(result.inputTokensIncludeCacheRead).toBe(false);
  });

  it("serializes inputTokensIncludeCacheRead as true when field is true in database", async () => {
    const channelWithTrue = { ...sampleChannel, inputTokensIncludeCacheRead: true };
    relayChannelRepository.findVisibleById.mockResolvedValue(channelWithTrue);

    const result = await service.getChannel("channel-1", "actor-user");

    expect(result.inputTokensIncludeCacheRead).toBe(true);
  });
});
