import { beforeEach, describe, expect, it, vi } from "vitest";
import { MonthlyPassService } from "../../../src/services/billing/monthly-pass.service";
import { MANAGED_STATUS } from "../../../src/constant/status";
import { OperationCategory, OperationType } from "../../../src/constant/operation-type";
import { BadRequestError, NotFoundError } from "../../../src/util/errors";

describe("MonthlyPassService publish flow", () => {
  const monthlyPassRepository = {
    findTemplateById: vi.fn(),
    findTemplateByName: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    listPublishedTemplates: vi.fn(),
    countUserPassesByUserAndTemplateSince: vi.fn(),
    purchaseUserPass: vi.fn(),
  };
  const userRepository = {
    findById: vi.fn(),
  };
  const relayChannelRepository = {
    findNamesByIds: vi.fn(),
  };
  const groupRepository = {};
  const modelPricingRepository = {};
  const businessLogService = {
    logOperation: vi.fn(),
  };
  const configService = {};

  const MonthlyPassServiceCtor = MonthlyPassService as unknown as new (...args: any[]) => MonthlyPassService;

  const service = new MonthlyPassServiceCtor(
    monthlyPassRepository,
    userRepository,
    relayChannelRepository,
    groupRepository,
    modelPricingRepository,
    businessLogService,
    configService,
  );

  const now = new Date("2026-05-07T12:00:00.000Z");
  const draftTemplateRecord = {
    id: "template-1",
    name: "Starter Pack",
    description: "starter",
    publishStatus: "draft",
    publishedAt: null,
    defaultQuota: 10,
    dailyQuota: null,
    quotaUnit: "amount",
    quotaWindowHours: null,
    validityDays: 30,
    allowBalanceRedemption: true,
    allowedModels: null,
    allowedChannels: null,
    status: MANAGED_STATUS.ENABLED,
    createTime: now,
    updateTime: now,
  };

  const publishedTemplateRecord = {
    ...draftTemplateRecord,
    publishStatus: "published",
    publishedAt: now,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    monthlyPassRepository.findTemplateByName.mockResolvedValue(null);
    monthlyPassRepository.countUserPassesByUserAndTemplateSince.mockResolvedValue(0);
    Object.assign(configService, {
      getRechargeRatio: vi.fn().mockResolvedValue(2),
    });
  });

  it("derives default quota from original price times recharge ratio", async () => {
    monthlyPassRepository.createTemplate.mockImplementation(async (data: Record<string, unknown>) => ({
      id: "template-derived",
      name: data.name,
      description: data.description ?? null,
      publishStatus: "draft",
      publishedAt: null,
      defaultQuota: data.defaultQuota,
      dailyQuota: data.dailyQuota ?? null,
      quotaUnit: data.quotaUnit ?? "amount",
      quotaWindowHours: null,
      allowBalanceRedemption: data.allowBalanceRedemption ?? true,
      allowedModels: null,
      allowedChannels: null,
      status: MANAGED_STATUS.ENABLED,
      createTime: now,
      updateTime: now,
      originalPrice: data.originalPrice,
      discountPercent: data.discountPercent,
      discountedPrice: data.discountedPrice,
      rechargeRatio: data.rechargeRatio,
      quotaWindows: [],
    }));

    await service.createTemplate(
      {
        name: "Discounted Pack",
        originalPrice: 100,
        discountPercent: 50,
        validityDays: 45,
      },
      "actor-1",
    );

    expect(monthlyPassRepository.createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        discountedPrice: 50,
        rechargeRatio: 2,
        defaultQuota: 200,
        validityDays: 45,
      }),
      expect.any(Array),
    );
  });

  it("derives a zero discounted price for a free template", async () => {
    monthlyPassRepository.createTemplate.mockImplementation(async (data: Record<string, unknown>) => ({
      id: "template-free",
      name: data.name,
      description: null,
      publishStatus: "draft",
      publishedAt: null,
      defaultQuota: data.defaultQuota,
      dailyQuota: null,
      quotaUnit: "amount",
      quotaWindowHours: null,
      allowBalanceRedemption: true,
      allowedModels: null,
      allowedChannels: null,
      status: MANAGED_STATUS.ENABLED,
      createTime: now,
      updateTime: now,
      originalPrice: data.originalPrice,
      discountPercent: data.discountPercent,
      discountedPrice: data.discountedPrice,
      rechargeRatio: data.rechargeRatio,
      quotaWindows: [],
    }));

    await service.createTemplate(
      {
        name: "Free Pack",
        originalPrice: 100,
        discountPercent: 0,
      },
      "actor-1",
    );

    expect(monthlyPassRepository.createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        discountedPrice: 0,
        defaultQuota: 200,
      }),
      expect.any(Array),
    );
  });

  it("publishes a draft template and writes audit log", async () => {
    monthlyPassRepository.findTemplateById.mockResolvedValue(draftTemplateRecord);
    monthlyPassRepository.updateTemplate.mockImplementation(async (_id: string, data: Record<string, unknown>) => ({
      ...draftTemplateRecord,
      ...data,
      publishedAt: data.publishedAt as Date,
    }));

    const result = await service.publishTemplate("template-1", "actor-1");

    expect(monthlyPassRepository.findTemplateById).toHaveBeenCalledWith("template-1");
    expect(monthlyPassRepository.updateTemplate).toHaveBeenCalledWith(
      "template-1",
      expect.objectContaining({
        publishStatus: "published",
        publishedAt: expect.any(Date),
      }),
    );
    expect(result.publishStatus).toBe("published");
    expect(result.publishedAt).toBeInstanceOf(Date);
    expect(businessLogService.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: OperationType.MONTHLY_PASS_TEMPLATE_PUBLISH,
        operationCategory: OperationCategory.BILLING,
        actorUserId: "actor-1",
        targetResourceId: "template-1",
        changes: { publishStatus: "published" },
        success: true,
      }),
    );
  });

  it("rejects publishing a missing template", async () => {
    monthlyPassRepository.findTemplateById.mockResolvedValue(null);

    await expect(service.publishTemplate("missing", "actor-1")).rejects.toThrow(NotFoundError);
    expect(monthlyPassRepository.updateTemplate).not.toHaveBeenCalled();
  });

  it("rejects publishing an already published template", async () => {
    monthlyPassRepository.findTemplateById.mockResolvedValue(publishedTemplateRecord);

    await expect(service.publishTemplate("template-1", "actor-1")).rejects.toThrow(BadRequestError);
    expect(monthlyPassRepository.updateTemplate).not.toHaveBeenCalled();
  });

  it("unpublishes a published template and clears publishedAt", async () => {
    monthlyPassRepository.findTemplateById.mockResolvedValue(publishedTemplateRecord);
    monthlyPassRepository.updateTemplate.mockImplementation(async (_id: string, data: Record<string, unknown>) => ({
      ...publishedTemplateRecord,
      ...data,
    }));

    const result = await service.unpublishTemplate("template-1", "actor-1");

    expect(monthlyPassRepository.updateTemplate).toHaveBeenCalledWith(
      "template-1",
      expect.objectContaining({
        publishStatus: "draft",
        publishedAt: null,
      }),
    );
    expect(result.publishStatus).toBe("draft");
    expect(result.publishedAt).toBeUndefined();
    expect(businessLogService.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: OperationType.MONTHLY_PASS_TEMPLATE_UNPUBLISH,
        operationCategory: OperationCategory.BILLING,
        actorUserId: "actor-1",
        targetResourceId: "template-1",
        changes: { publishStatus: "draft" },
        success: true,
      }),
    );
  });

  it("rejects unpublishing an already draft template", async () => {
    monthlyPassRepository.findTemplateById.mockResolvedValue(draftTemplateRecord);

    await expect(service.unpublishTemplate("template-1", "actor-1")).rejects.toThrow(BadRequestError);
    expect(monthlyPassRepository.updateTemplate).not.toHaveBeenCalled();
  });

  it("lists published templates as dto records", async () => {
    monthlyPassRepository.listPublishedTemplates.mockResolvedValue([
      publishedTemplateRecord,
      {
        ...publishedTemplateRecord,
        id: "template-2",
        name: "Advanced Pack",
        allowedModels: JSON.stringify(["gpt-4o", "claude-3.7"]),
        allowedChannels: JSON.stringify(["channel-1"]),
      },
    ]);

    const result = await service.listPublishedTemplates();

    expect(monthlyPassRepository.listPublishedTemplates).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
    expect(result[0].publishStatus).toBe("published");
    expect(result[0].publishedAt).toBeInstanceOf(Date);
    expect(result[0].allowBalanceRedemption).toBe(true);
    expect(result[1].allowedModels).toEqual(["gpt-4o", "claude-3.7"]);
    expect(result[1].allowedChannels).toEqual(["channel-1"]);
  });

  it("claims published template with balance purchase", async () => {
    monthlyPassRepository.findTemplateById.mockResolvedValue({
      ...publishedTemplateRecord,
      discountedPrice: 18.5,
      rechargeRatio: 2,
      defaultQuota: 10,
      quotaWindows: [],
      allowBalanceRedemption: true,
      validityDays: 45,
    });
    monthlyPassRepository.purchaseUserPass.mockResolvedValue({
      id: "pass-1",
      userId: "user-1",
      templateId: "template-1",
      startAt: now,
      endAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      totalQuota: 10,
      dailyQuota: null,
      quotaUnit: "amount",
      quotaWindowHours: null,
      quotaWindows: [],
      usedQuota: 0,
      remainingQuota: 10,
      assignedBy: "user-1",
      note: "self-claimed",
      status: MANAGED_STATUS.ENABLED,
      createTime: now,
      updateTime: now,
      template: { name: "Starter Pack", description: null, allowedModels: null, allowedChannels: null },
      user: { username: "alice" },
    });

    const result = await service.claimPublishedTemplate({ templateId: "template-1" }, "user-1");

    expect(monthlyPassRepository.purchaseUserPass).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Array),
      expect.objectContaining({ purchaseAmount: 37 }),
    );
    const createdPass = monthlyPassRepository.purchaseUserPass.mock.calls[0][0];
    expect(createdPass.endAt.getTime() - createdPass.startAt.getTime()).toBe(45 * 24 * 60 * 60 * 1000);
    expect(result.purchaseAmount).toBe(37);
    expect(result.userPass.templateName).toBe("Starter Pack");
    expect(businessLogService.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: OperationType.MONTHLY_PASS_SELF_CLAIM,
        changes: expect.objectContaining({ purchaseAmount: 37 }),
      }),
    );
  });

  it("claims a free template without requiring a positive purchase amount", async () => {
    monthlyPassRepository.findTemplateById.mockResolvedValue({
      ...publishedTemplateRecord,
      discountedPrice: 0,
      defaultQuota: 10,
      quotaWindows: [],
      allowBalanceRedemption: true,
    });
    monthlyPassRepository.purchaseUserPass.mockResolvedValue({
      id: "pass-free",
      userId: "user-1",
      templateId: "template-1",
      startAt: now,
      endAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      totalQuota: 10,
      dailyQuota: null,
      quotaUnit: "amount",
      quotaWindowHours: null,
      quotaWindows: [],
      usedQuota: 0,
      remainingQuota: 10,
      assignedBy: "user-1",
      note: "self-claimed",
      status: MANAGED_STATUS.ENABLED,
      createTime: now,
      updateTime: now,
      template: { name: "Starter Pack", description: null, allowedModels: null, allowedChannels: null },
      user: { username: "alice" },
    });

    const result = await service.claimPublishedTemplate({ templateId: "template-1" }, "user-1");

    expect(monthlyPassRepository.purchaseUserPass).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Array),
      expect.objectContaining({ purchaseAmount: 0 }),
    );
    expect(result.purchaseAmount).toBe(0);
  });

  it("rejects claim when template purchase limit is reached", async () => {
    monthlyPassRepository.findTemplateById.mockResolvedValue({
      ...publishedTemplateRecord,
      discountedPrice: 18.5,
      rechargeRatio: 2,
      defaultQuota: 10,
      quotaWindows: [],
      allowBalanceRedemption: true,
      purchaseLimitPerUser: 2,
      purchaseLimitWindowDays: 30,
    });
    monthlyPassRepository.purchaseUserPass.mockRejectedValue(
      new BadRequestError("purchase limit exceeded: at most 2 claim(s)"),
    );

    await expect(service.claimPublishedTemplate({ templateId: "template-1" }, "user-1")).rejects.toThrow(
      BadRequestError,
    );

    expect(monthlyPassRepository.purchaseUserPass).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Array),
      expect.objectContaining({
        limit: expect.objectContaining({ maximum: 2, windowStart: expect.any(Date) }),
      }),
    );
  });
});

describe("MonthlyPassService quota window usage summaries", () => {
  const monthlyPassRepository = {
    listUserPasses: vi.fn(),
    getUsageSummaryByQuotaWindowRules: vi.fn(),
  };
  const userRepository = {};
  const relayChannelRepository = {
    listActiveByIds: vi.fn(),
  };
  const groupRepository = {};
  const modelPricingRepository = {};
  const businessLogService = {
    logOperation: vi.fn(),
  };
  const configService = {};

  const MonthlyPassServiceCtor = MonthlyPassService as unknown as new (...args: any[]) => MonthlyPassService;

  const service = new MonthlyPassServiceCtor(
    monthlyPassRepository,
    userRepository,
    relayChannelRepository,
    groupRepository,
    modelPricingRepository,
    businessLogService,
    configService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses quotaUnit-specific usage summary keys for same-hour windows", async () => {
    const now = new Date("2026-05-07T12:00:00.000Z");
    monthlyPassRepository.listUserPasses.mockResolvedValue({
      total: 1,
      records: [
        {
          id: "pass-1",
          userId: "user-1",
          templateId: "template-1",
          startAt: now,
          endAt: now,
          totalQuota: 100,
          dailyQuota: 10,
          quotaUnit: "amount",
          quotaWindowHours: 24,
          quotaWindows: [
            { id: "window-amount", quotaLimit: 10, quotaUnit: "amount", quotaWindowHours: 24 },
            { id: "window-request", quotaLimit: 5, quotaUnit: "request", quotaWindowHours: 24 },
          ],
          usedQuota: 0,
          remainingQuota: 100,
          assignedBy: null,
          note: null,
          status: MANAGED_STATUS.ENABLED,
          createTime: now,
          updateTime: now,
          template: {
            name: "Starter Pack",
            description: null,
            allowedModels: null,
            allowedChannels: null,
          },
          user: { username: "alice" },
        },
      ],
    });
    relayChannelRepository.listActiveByIds.mockResolvedValue([]);
    monthlyPassRepository.getUsageSummaryByQuotaWindowRules.mockResolvedValue({
      "pass-1:24:amount": {
        coveredAmount: 2,
        coveredRequests: 99,
        coveredTokens: 0,
      },
      "pass-1:24:request": {
        coveredAmount: 999,
        coveredRequests: 3,
        coveredTokens: 0,
      },
    });

    const result = await service.listUserPasses(1, 20);

    expect(monthlyPassRepository.getUsageSummaryByQuotaWindowRules).toHaveBeenCalledWith(
      [
        { passId: "pass-1", quotaUnit: "amount", quotaWindowHours: 24 },
        { passId: "pass-1", quotaUnit: "request", quotaWindowHours: 24 },
      ],
      expect.any(Date),
    );
    expect(result.records[0].quotaWindows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "window-amount",
          usedQuota: 2,
          remainingQuota: 8,
        }),
        expect.objectContaining({
          id: "window-request",
          usedQuota: 3,
          remainingQuota: 2,
        }),
      ]),
    );
  });
});

describe("MonthlyPassService historical usage channel display", () => {
  const monthlyPassRepository = {
    listUsageRecords: vi.fn(),
  };
  const MonthlyPassServiceCtor = MonthlyPassService as unknown as new (...args: any[]) => MonthlyPassService;
  const service = new MonthlyPassServiceCtor(monthlyPassRepository, {}, {}, {}, {}, {}, {});
  const now = new Date("2026-07-16T00:00:00.000Z");

  const buildUsageRecord = (overrides: Record<string, unknown>) => ({
    id: "usage-1",
    userMonthlyPassId: "pass-1",
    userId: "user-1",
    relayUsageId: "relay-usage-1",
    model: "gpt-5.4",
    channelName: null,
    displayChannelId: null,
    displayChannelName: null,
    coveredAmount: 1,
    coveredRequests: 1,
    coveredTokens: 10,
    totalRequestCost: 1,
    remainingRequestCost: 0,
    description: null,
    createTime: now,
    userMonthlyPass: {
      template: { id: "template-1", name: "Starter Pack" },
    },
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restores the original legacy channel name ahead of a backfilled placeholder", async () => {
    monthlyPassRepository.listUsageRecords.mockResolvedValue({
      total: 1,
      records: [
        buildUsageRecord({
          channelName: "Legacy Physical Channel",
          displayChannelId: "guessed-pool-id",
          displayChannelName: "历史混池渠道",
        }),
      ],
    });

    const result = await service.listUsages();

    expect(result.records[0]).toEqual(
      expect.objectContaining({
        displayChannelName: "Legacy Physical Channel",
        displayChannelId: undefined,
      }),
    );
  });

  it("keeps the immutable logical snapshot for new usage records", async () => {
    monthlyPassRepository.listUsageRecords.mockResolvedValue({
      total: 1,
      records: [
        buildUsageRecord({
          displayChannelId: "logical-pool-id",
          displayChannelName: "Logical Pool",
        }),
      ],
    });

    const result = await service.listUsages();

    expect(result.records[0]).toEqual(
      expect.objectContaining({
        displayChannelName: "Logical Pool",
        displayChannelId: "logical-pool-id",
      }),
    );
  });

  it("leaves the channel absent when no immutable record evidence exists", async () => {
    monthlyPassRepository.listUsageRecords.mockResolvedValue({
      total: 1,
      records: [buildUsageRecord({ displayChannelName: "历史渠道（未记录）" })],
    });

    const result = await service.listUsages();

    expect(result.records[0]?.displayChannelName).toBeUndefined();
    expect(result.records[0]?.displayChannelId).toBeUndefined();
  });
});

describe("MonthlyPassService channel pool coverage", () => {
  const monthlyPassRepository = {
    findActivePassCandidates: vi.fn(),
    getUsageSummaryByQuotaWindowRules: vi.fn(),
  };
  const relayPoolResolver = {
    resolveActiveLeaves: vi.fn(),
  };
  const MonthlyPassServiceCtor = MonthlyPassService as unknown as new (...args: any[]) => MonthlyPassService;
  const service = new MonthlyPassServiceCtor(monthlyPassRepository, {}, {}, {}, {}, {}, {}, relayPoolResolver);

  const activePass = {
    id: "pass-1",
    dailyQuota: null,
    quotaUnit: "amount",
    quotaWindowHours: null,
    quotaWindows: [],
    template: {
      allowedModels: JSON.stringify(["gpt-4o"]),
      allowedChannels: JSON.stringify(["pool-root"]),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    monthlyPassRepository.findActivePassCandidates.mockResolvedValue([activePass]);
  });

  it("covers a runtime leaf selected through a configured pool root", async () => {
    relayPoolResolver.resolveActiveLeaves.mockResolvedValue([{ id: "leaf-1" }]);

    await expect(service.hasActiveCoverage("user-1", "gpt-4o", "leaf-1")).resolves.toBe(true);
    expect(relayPoolResolver.resolveActiveLeaves).toHaveBeenCalledWith([{ id: "pool-root" }]);
  });

  it("does not cover an unrelated runtime leaf", async () => {
    relayPoolResolver.resolveActiveLeaves.mockResolvedValue([{ id: "leaf-1" }]);

    await expect(service.hasActiveCoverage("user-1", "gpt-4o", "unrelated-leaf")).resolves.toBe(false);
  });

  it("does not cover a model outside the template allowance", async () => {
    await expect(service.hasActiveCoverage("user-1", "claude-3-7", "leaf-1")).resolves.toBe(false);
    expect(relayPoolResolver.resolveActiveLeaves).not.toHaveBeenCalled();
  });
});

describe("MonthlyPassService template scope validation", () => {
  const monthlyPassRepository = {
    findTemplateById: vi.fn(),
    findTemplateByName: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
  };
  const modelPricingRepository = {
    listActiveOrderedByModel: vi.fn(),
  };
  const businessLogService = { logOperation: vi.fn() };
  const relayChannelService = { listChannelOptions: vi.fn() };
  const MonthlyPassServiceCtor = MonthlyPassService as unknown as new (...args: any[]) => MonthlyPassService;
  const service = new MonthlyPassServiceCtor(
    monthlyPassRepository,
    {},
    {},
    {},
    modelPricingRepository,
    businessLogService,
    {},
    {},
    relayChannelService,
  );
  const templateRecord = {
    id: "template-1",
    name: "Scoped Pass",
    description: null,
    publishStatus: "draft",
    publishedAt: null,
    originalPrice: null,
    discountPercent: null,
    discountedPrice: null,
    rechargeRatio: null,
    defaultQuota: 10,
    dailyQuota: null,
    quotaUnit: "amount",
    quotaWindowHours: null,
    allowBalanceRedemption: true,
    purchaseLimitPerUser: null,
    purchaseLimitWindowDays: null,
    allowedModels: JSON.stringify(["gpt-4o"]),
    allowedChannels: JSON.stringify(["channel-1"]),
    status: MANAGED_STATUS.ENABLED,
    createTime: new Date("2026-01-01T00:00:00.000Z"),
    updateTime: new Date("2026-01-01T00:00:00.000Z"),
    quotaWindows: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    monthlyPassRepository.findTemplateByName.mockResolvedValue(null);
    modelPricingRepository.listActiveOrderedByModel.mockResolvedValue([
      { model: "gpt-4o", provider: "openai/gpt-4o" },
      { model: "claude-sonnet", provider: "anthropic/claude-sonnet" },
    ]);
    relayChannelService.listChannelOptions.mockResolvedValue([
      {
        id: "channel-1",
        name: "Primary",
        enabled: true,
        multiplier: 1,
        allowedFormats: "openai",
        modelCapabilities: [
          {
            catalogModelName: "gpt-4o",
            requestModelId: "openai/gpt-4o",
            supportedRequestFormats: ["openai"],
          },
        ],
      },
    ]);
  });

  it("rejects request model ids when the catalog name is required", async () => {
    await expect(
      service.createTemplate({ name: "Invalid", defaultQuota: 10, allowedModels: ["openai/gpt-4o"] }, "actor-1"),
    ).rejects.toThrow("Unknown or inactive monthly pass models");
    expect(monthlyPassRepository.createTemplate).not.toHaveBeenCalled();
  });

  it("rejects selected channels without effective model capabilities", async () => {
    relayChannelService.listChannelOptions.mockResolvedValue([
      {
        id: "empty-pool",
        name: "Empty Pool",
        enabled: true,
        multiplier: 1,
        allowedFormats: "auto",
        modelCapabilities: [],
      },
    ]);

    await expect(
      service.createTemplate({ name: "Invalid", defaultQuota: 10, allowedChannels: ["empty-pool"] }, "actor-1"),
    ).rejects.toThrow("no usable model capabilities");
  });

  it("rejects model and channel scopes without an effective intersection", async () => {
    await expect(
      service.createTemplate(
        {
          name: "Invalid",
          defaultQuota: 10,
          allowedModels: ["claude-sonnet"],
          allowedChannels: ["channel-1"],
        },
        "actor-1",
      ),
    ).rejects.toThrow("unavailable through the selected channels");
  });

  it("validates the merged persisted scope during metadata-only updates", async () => {
    monthlyPassRepository.findTemplateById.mockResolvedValue(templateRecord);
    relayChannelService.listChannelOptions.mockResolvedValue([]);

    await expect(service.updateTemplate("template-1", { description: "changed" }, "actor-1")).rejects.toThrow(
      "Unknown, inactive, or inaccessible monthly pass channels",
    );
    expect(monthlyPassRepository.updateTemplate).not.toHaveBeenCalled();
  });

  it("revalidates a draft scope immediately before publication", async () => {
    monthlyPassRepository.findTemplateById.mockResolvedValue(templateRecord);
    modelPricingRepository.listActiveOrderedByModel.mockResolvedValue([]);

    await expect(service.publishTemplate("template-1", "actor-1")).rejects.toThrow(
      "Unknown or inactive monthly pass models",
    );
    expect(monthlyPassRepository.updateTemplate).not.toHaveBeenCalled();
  });
});
