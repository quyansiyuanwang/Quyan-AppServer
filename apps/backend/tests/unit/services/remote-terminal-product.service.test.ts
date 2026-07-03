import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteTerminalProductService } from "../../../src/services/remote-terminal/remote-terminal-product.service";
import { MANAGED_STATUS } from "../../../src/constant/status";
import { OperationCategory, OperationType } from "../../../src/constant/operation-type";
import { BadRequestError, ForbiddenError } from "../../../src/util/errors";

describe("RemoteTerminalProductService", () => {
  const productRepository = {
    findTemplateById: vi.fn(),
    countUserEntitlementsInWindow: vi.fn(),
    purchaseEntitlement: vi.fn(),
    purchaseAndUpdateEntitlement: vi.fn(),
    findTokenByEntitlementId: vi.fn(),
    upsertEntitlementToken: vi.fn(),
    findEntitlementById: vi.fn(),
    findDeviceBindingById: vi.fn(),
    countRevokedDeviceBindingsForEntitlementInWindow: vi.fn(),
    updateDeviceBinding: vi.fn(),
  };

  const userRepository = {
    findActiveById: vi.fn(),
    findUsernamesByIds: vi.fn(),
  };

  const businessLogService = {
    logOperation: vi.fn(),
  };

  const configService = {
    getRemoteTerminalUnbindConfig: vi.fn(),
  };

  const RemoteTerminalProductServiceCtor = RemoteTerminalProductService as unknown as new (
    ...args: any[]
  ) => RemoteTerminalProductService;

  const service = new RemoteTerminalProductServiceCtor(
    productRepository as any,
    userRepository as any,
    businessLogService as any,
    configService as any,
  );

  const now = new Date("2026-06-10T12:00:00.000Z");

  const publishedTemplate = {
    id: "tpl-1",
    name: "Starter Remote",
    description: "starter plan",
    publishStatus: "published",
    publishedAt: now,
    billingUnit: "day",
    minimumPurchaseUnits: 1,
    devicePrice: 1.5,
    terminalPrice: 2.25,
    deviceDailyPrice: 1.5,
    terminalDailyPrice: 2.25,
    currency: "曲",
    purchaseLimitPerUser: null,
    purchaseLimitWindowDays: null,
    status: MANAGED_STATUS.ENABLED,
    createTime: now,
    updateTime: now,
  };

  const createdEntitlement = {
    id: "ent-1",
    userId: "user-1",
    user: { username: "alice" },
    templateId: "tpl-1",
    template: { name: "Starter Remote" },
    name: "Starter Remote",
    description: "starter plan",
    startAt: now,
    endAt: new Date("2026-06-15T12:00:00.000Z"),
    billingUnit: "day",
    purchaseUnits: 5,
    durationDays: 5,
    deviceLimit: 2,
    terminalLimit: 1,
    purchasedDeviceCount: 2,
    purchasedTerminalCount: 1,
    devicePrice: 1.5,
    terminalPrice: 2.25,
    deviceDailyPrice: 1.5,
    terminalDailyPrice: 2.25,
    purchaseAmount: 26.25,
    currency: "曲",
    assignedBy: "user-1",
    note: "self-claimed",
    status: MANAGED_STATUS.ENABLED,
    createTime: now,
    updateTime: now,
    devices: [],
    registrationToken: null,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.clearAllMocks();
    userRepository.findActiveById.mockResolvedValue({ id: "user-1", username: "alice" });
    userRepository.findUsernamesByIds.mockResolvedValue([{ id: "user-1", username: "alice" }]);
    productRepository.countUserEntitlementsInWindow.mockResolvedValue(0);
    productRepository.countRevokedDeviceBindingsForEntitlementInWindow.mockResolvedValue(0);
    businessLogService.logOperation.mockResolvedValue(undefined);
    configService.getRemoteTerminalUnbindConfig.mockResolvedValue({
      maxCount: 2,
      windowHours: 24,
      rebindCooldownMinutes: 60,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects claim when template does not support requested device quota", async () => {
    productRepository.findTemplateById.mockResolvedValue({
      ...publishedTemplate,
      devicePrice: null,
      deviceDailyPrice: null,
      terminalPrice: 3,
      terminalDailyPrice: 3,
    });

    await expect(
      service.claimPublishedTemplate(
        {
          templateId: "tpl-1",
          purchaseUnits: 3,
          deviceCount: 1,
          terminalCount: 1,
        },
        "user-1",
      ),
    ).rejects.toThrow(BadRequestError);

    expect(productRepository.purchaseEntitlement).not.toHaveBeenCalled();
  });

  it("enforces purchase limit window before creating entitlement", async () => {
    productRepository.findTemplateById.mockResolvedValue({
      ...publishedTemplate,
      purchaseLimitPerUser: 1,
      purchaseLimitWindowDays: 30,
    });
    productRepository.countUserEntitlementsInWindow.mockResolvedValue(1);

    await expect(
      service.claimPublishedTemplate(
        {
          templateId: "tpl-1",
          purchaseUnits: 5,
          deviceCount: 1,
          terminalCount: 0,
        },
        "user-1",
      ),
    ).rejects.toThrow(BadRequestError);

    expect(productRepository.countUserEntitlementsInWindow).toHaveBeenCalledWith("user-1", "tpl-1", expect.any(Date));
    expect(productRepository.purchaseEntitlement).not.toHaveBeenCalled();
  });

  it("creates priced entitlement and registration token for valid self-claim", async () => {
    productRepository.findTemplateById.mockResolvedValue(publishedTemplate);
    productRepository.purchaseEntitlement.mockResolvedValue(createdEntitlement);
    productRepository.findTokenByEntitlementId.mockResolvedValue(null);
    productRepository.upsertEntitlementToken.mockResolvedValue({
      id: "rtok-1",
      entitlementId: "ent-1",
      token: "rtm_generated_token",
      label: "default",
      expiresAt: null,
      lastUsedAt: null,
      status: MANAGED_STATUS.ENABLED,
      createTime: now,
      updateTime: now,
    });

    const result = await service.claimPublishedTemplate(
      {
        templateId: "tpl-1",
        purchaseUnits: 5,
        deviceCount: 2,
        terminalCount: 1,
      },
      "user-1",
    );

    expect(productRepository.purchaseEntitlement).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        templateName: "Starter Remote",
        entitlement: expect.objectContaining({
          templateId: "tpl-1",
          billingUnit: "day",
          purchaseUnits: 5,
          durationDays: 5,
          deviceLimit: 2,
          terminalLimit: 1,
          purchasedDeviceCount: 2,
          purchasedTerminalCount: 1,
          devicePrice: 1.5,
          terminalPrice: 2.25,
          purchaseAmount: 26.25,
          assignedBy: "user-1",
          note: "self-claimed",
        }),
      }),
    );
    expect(productRepository.upsertEntitlementToken).toHaveBeenCalledWith(
      "ent-1",
      expect.objectContaining({
        entitlementId: "ent-1",
        label: "default",
        status: MANAGED_STATUS.ENABLED,
        token: expect.stringMatching(/^rtm_/),
      }),
    );
    expect(result.purchaseAmount).toBe(26.25);
    expect(result.registrationToken?.token).toBe("rtm_generated_token");
    expect(businessLogService.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: OperationType.REMOTE_TERMINAL_ASSIGNMENT_SELF_CLAIM,
        operationCategory: OperationCategory.RELAY,
        actorUserId: "user-1",
        targetResourceId: "ent-1",
        success: true,
      }),
    );
  });

  it("blocks current user revoke when unbind limit is reached", async () => {
    productRepository.findDeviceBindingById.mockResolvedValue({
      id: "binding-1",
      entitlementId: "ent-1",
      userId: "user-1",
      hostname: "host-1",
      status: MANAGED_STATUS.ENABLED,
    });
    productRepository.countRevokedDeviceBindingsForEntitlementInWindow.mockResolvedValue(2);

    await expect(service.revokeCurrentUserDevice("user-1", "binding-1")).rejects.toThrow(/unbind limit reached/i);

    expect(productRepository.updateDeviceBinding).not.toHaveBeenCalled();
  });

  it("revokes current user device when under configured limit", async () => {
    productRepository.findDeviceBindingById.mockResolvedValue({
      id: "binding-1",
      entitlementId: "ent-1",
      userId: "user-1",
      hostname: "host-1",
      status: MANAGED_STATUS.ENABLED,
    });

    await service.revokeCurrentUserDevice("user-1", "binding-1");

    expect(productRepository.updateDeviceBinding).toHaveBeenCalledWith(
      "binding-1",
      expect.objectContaining({
        status: MANAGED_STATUS.DELETED,
        online: false,
      }),
    );
  });

  it("merges renewal into target entitlement when quotas match", async () => {
    const existingEntitlement = {
      ...createdEntitlement,
      id: "ent-existing",
      startAt: new Date("2026-06-04T12:00:00.000Z"),
      endAt: new Date("2026-06-16T12:00:00.000Z"),
      purchaseUnits: 12,
      durationDays: 12,
      deviceLimit: 1,
      terminalLimit: 1,
      purchasedDeviceCount: 1,
      purchasedTerminalCount: 1,
      purchaseAmount: 22.5,
      registrationToken: {
        id: "rtok-existing",
        entitlementId: "ent-existing",
        token: "rtm_existing_token",
        label: "default",
        expiresAt: null,
        lastUsedAt: null,
        status: MANAGED_STATUS.ENABLED,
        createTime: now,
        updateTime: now,
      },
    };

    const updatedEntitlement = {
      ...existingEntitlement,
      endAt: new Date("2026-06-17T12:00:00.000Z"),
      purchaseUnits: 13,
      durationDays: 13,
      purchaseAmount: 26.25,
    };

    productRepository.findTemplateById.mockResolvedValue(publishedTemplate);
    productRepository.findEntitlementById.mockResolvedValue(existingEntitlement);
    productRepository.purchaseAndUpdateEntitlement.mockResolvedValue(updatedEntitlement);

    const result = await service.claimPublishedTemplate(
      {
        templateId: "tpl-1",
        targetEntitlementId: "ent-existing",
        purchaseUnits: 1,
        deviceCount: 1,
        terminalCount: 1,
      },
      "user-1",
    );

    expect(productRepository.purchaseAndUpdateEntitlement).toHaveBeenCalledWith(
      expect.objectContaining({
        entitlementId: "ent-existing",
        entitlement: expect.objectContaining({
          billingUnit: "day",
          purchaseUnits: 13,
          deviceLimit: 1,
          terminalLimit: 1,
          purchasedDeviceCount: 1,
          purchasedTerminalCount: 1,
          purchaseAmount: 26.25,
        }),
      }),
    );
    expect(productRepository.purchaseEntitlement).not.toHaveBeenCalled();
    expect(result.id).toBe("ent-existing");
    expect(result.purchaseAmount).toBe(26.25);
    expect(result.registrationToken?.token).toBe("rtm_existing_token");
  });

  it("rejects merge requests that downgrade target quotas", async () => {
    const existingEntitlement = {
      ...createdEntitlement,
      id: "ent-existing",
      startAt: new Date("2026-06-04T12:00:00.000Z"),
      endAt: new Date("2026-06-16T12:00:00.000Z"),
      purchaseUnits: 12,
      durationDays: 12,
      deviceLimit: 1,
      terminalLimit: 1,
      purchasedDeviceCount: 1,
      purchasedTerminalCount: 1,
      purchaseAmount: 22.5,
      registrationToken: {
        id: "rtok-existing",
        entitlementId: "ent-existing",
        token: "rtm_existing_token",
        label: "default",
        expiresAt: null,
        lastUsedAt: null,
        status: MANAGED_STATUS.ENABLED,
        createTime: now,
        updateTime: now,
      },
    };

    productRepository.findTemplateById.mockResolvedValue(publishedTemplate);
    productRepository.findEntitlementById.mockResolvedValue(existingEntitlement);

    await expect(
      service.claimPublishedTemplate(
        {
          templateId: "tpl-1",
          targetEntitlementId: "ent-existing",
          purchaseUnits: 1,
          deviceCount: 0,
          terminalCount: 1,
        },
        "user-1",
      ),
    ).rejects.toThrow(BadRequestError);

    expect(productRepository.purchaseAndUpdateEntitlement).not.toHaveBeenCalled();
    expect(productRepository.purchaseEntitlement).not.toHaveBeenCalled();
  });

  it("upgrades target entitlement in place and charges renewal plus upgrade delta", async () => {
    const existingEntitlement = {
      ...createdEntitlement,
      id: "ent-existing",
      startAt: new Date("2026-06-04T12:00:00.000Z"),
      endAt: new Date("2026-06-16T12:00:00.000Z"),
      purchaseUnits: 12,
      durationDays: 12,
      deviceLimit: 1,
      terminalLimit: 1,
      purchasedDeviceCount: 1,
      purchasedTerminalCount: 1,
      purchaseAmount: 22.5,
      registrationToken: {
        id: "rtok-existing",
        entitlementId: "ent-existing",
        token: "rtm_existing_token",
        label: "default",
        expiresAt: null,
        lastUsedAt: null,
        status: MANAGED_STATUS.ENABLED,
        createTime: now,
        updateTime: now,
      },
    };

    const updatedEntitlement = {
      ...existingEntitlement,
      endAt: new Date("2026-06-17T12:00:00.000Z"),
      purchaseUnits: 13,
      durationDays: 13,
      deviceLimit: 2,
      terminalLimit: 1,
      purchasedDeviceCount: 2,
      purchasedTerminalCount: 1,
      purchaseAmount: 36.75,
    };

    productRepository.findTemplateById.mockResolvedValue(publishedTemplate);
    productRepository.findEntitlementById.mockResolvedValue(existingEntitlement);
    productRepository.purchaseAndUpdateEntitlement.mockResolvedValue(updatedEntitlement);

    const result = await service.claimPublishedTemplate(
      {
        templateId: "tpl-1",
        targetEntitlementId: "ent-existing",
        purchaseUnits: 1,
        deviceCount: 2,
        terminalCount: 1,
      },
      "user-1",
    );

    expect(productRepository.purchaseAndUpdateEntitlement).toHaveBeenCalledWith(
      expect.objectContaining({
        entitlementId: "ent-existing",
        entitlement: expect.objectContaining({
          billingUnit: "day",
          purchaseUnits: 13,
          durationDays: 13,
          deviceLimit: 2,
          terminalLimit: 1,
          purchasedDeviceCount: 2,
          purchasedTerminalCount: 1,
          purchaseAmount: 36.75,
        }),
      }),
    );
    expect(productRepository.purchaseEntitlement).not.toHaveBeenCalled();
    expect(result.id).toBe("ent-existing");
    expect(result.deviceLimit).toBe(2);
    expect(result.terminalLimit).toBe(1);
    expect(result.purchaseAmount).toBe(36.75);
  });

  it("rejects purchase units below template minimum", async () => {
    productRepository.findTemplateById.mockResolvedValue({
      ...publishedTemplate,
      billingUnit: "week",
      minimumPurchaseUnits: 2,
      devicePrice: 10,
      terminalPrice: 14,
      deviceDailyPrice: Number((10 / 7).toFixed(4)),
      terminalDailyPrice: 2,
    });

    await expect(
      service.claimPublishedTemplate(
        {
          templateId: "tpl-1",
          purchaseUnits: 1,
          deviceCount: 1,
          terminalCount: 1,
        },
        "user-1",
      ),
    ).rejects.toThrow(BadRequestError);

    expect(productRepository.purchaseEntitlement).not.toHaveBeenCalled();
  });

  it("creates weekly billed entitlement with converted duration and unit pricing", async () => {
    const weeklyTemplate = {
      ...publishedTemplate,
      billingUnit: "week",
      minimumPurchaseUnits: 2,
      devicePrice: 10,
      terminalPrice: 14,
      deviceDailyPrice: Number((10 / 7).toFixed(4)),
      terminalDailyPrice: 2,
    };

    productRepository.findTemplateById.mockResolvedValue(weeklyTemplate);
    productRepository.purchaseEntitlement.mockResolvedValue({
      ...createdEntitlement,
      billingUnit: "week",
      purchaseUnits: 2,
      durationDays: 14,
      endAt: new Date("2026-06-24T12:00:00.000Z"),
      devicePrice: 10,
      terminalPrice: 14,
      deviceDailyPrice: Number((10 / 7).toFixed(4)),
      terminalDailyPrice: 2,
      purchaseAmount: 68,
    });
    productRepository.findTokenByEntitlementId.mockResolvedValue(null);
    productRepository.upsertEntitlementToken.mockResolvedValue({
      id: "rtok-1",
      entitlementId: "ent-1",
      token: "rtm_generated_token",
      label: "default",
      expiresAt: null,
      lastUsedAt: null,
      status: MANAGED_STATUS.ENABLED,
      createTime: now,
      updateTime: now,
    });

    const result = await service.claimPublishedTemplate(
      {
        templateId: "tpl-1",
        purchaseUnits: 2,
        deviceCount: 2,
        terminalCount: 1,
      },
      "user-1",
    );

    expect(productRepository.purchaseEntitlement).toHaveBeenCalledWith(
      expect.objectContaining({
        entitlement: expect.objectContaining({
          billingUnit: "week",
          purchaseUnits: 2,
          durationDays: 14,
          devicePrice: 10,
          terminalPrice: 14,
          deviceDailyPrice: Number((10 / 7).toFixed(4)),
          terminalDailyPrice: 2,
          purchaseAmount: 68,
        }),
      }),
    );
    expect(result.billingUnit).toBe("week");
    expect(result.purchaseUnits).toBe(2);
    expect(result.durationDays).toBe(14);
    expect(result.purchaseAmount).toBe(68);
  });

  it("charges weekly merge upgrades using renewal plus prorated delta", async () => {
    const weeklyTemplate = {
      ...publishedTemplate,
      billingUnit: "week",
      minimumPurchaseUnits: 1,
      devicePrice: 10,
      terminalPrice: 14,
      deviceDailyPrice: Number((10 / 7).toFixed(4)),
      terminalDailyPrice: 2,
    };

    const existingEntitlement = {
      ...createdEntitlement,
      id: "ent-existing",
      billingUnit: "week",
      purchaseUnits: 2,
      startAt: new Date("2026-06-04T12:00:00.000Z"),
      endAt: new Date("2026-06-16T12:00:00.000Z"),
      durationDays: 12,
      deviceLimit: 1,
      terminalLimit: 1,
      purchasedDeviceCount: 1,
      purchasedTerminalCount: 1,
      devicePrice: 10,
      terminalPrice: 14,
      deviceDailyPrice: Number((10 / 7).toFixed(4)),
      terminalDailyPrice: 2,
      purchaseAmount: 24,
      registrationToken: {
        id: "rtok-existing",
        entitlementId: "ent-existing",
        token: "rtm_existing_token",
        label: "default",
        expiresAt: null,
        lastUsedAt: null,
        status: MANAGED_STATUS.ENABLED,
        createTime: now,
        updateTime: now,
      },
    };

    const updatedEntitlement = {
      ...existingEntitlement,
      endAt: new Date("2026-06-23T12:00:00.000Z"),
      purchaseUnits: 3,
      durationDays: 19,
      deviceLimit: 2,
      purchasedDeviceCount: 2,
      purchaseAmount: 66.5714,
    };

    productRepository.findTemplateById.mockResolvedValue(weeklyTemplate);
    productRepository.findEntitlementById.mockResolvedValue(existingEntitlement);
    productRepository.purchaseAndUpdateEntitlement.mockResolvedValue(updatedEntitlement);

    const result = await service.claimPublishedTemplate(
      {
        templateId: "tpl-1",
        targetEntitlementId: "ent-existing",
        purchaseUnits: 1,
        deviceCount: 2,
        terminalCount: 1,
      },
      "user-1",
    );

    expect(productRepository.purchaseAndUpdateEntitlement).toHaveBeenCalledWith(
      expect.objectContaining({
        entitlementId: "ent-existing",
        entitlement: expect.objectContaining({
          billingUnit: "week",
          purchaseUnits: 3,
          durationDays: 19,
          deviceLimit: 2,
          terminalLimit: 1,
          purchaseAmount: 66.5714,
        }),
      }),
    );
    expect(result.purchaseAmount).toBe(66.5714);
  });

  it("recalculates merged purchase units from final range instead of accumulating stale stored units", async () => {
    const weeklyTemplate = {
      ...publishedTemplate,
      billingUnit: "week",
      minimumPurchaseUnits: 1,
      devicePrice: 10,
      terminalPrice: 14,
      deviceDailyPrice: Number((10 / 7).toFixed(4)),
      terminalDailyPrice: 2,
    };

    const existingEntitlement = {
      ...createdEntitlement,
      id: "ent-existing",
      billingUnit: "week",
      purchaseUnits: 5,
      durationDays: 12,
      startAt: new Date("2026-06-04T12:00:00.000Z"),
      endAt: new Date("2026-06-16T12:00:00.000Z"),
      deviceLimit: 1,
      terminalLimit: 1,
      purchasedDeviceCount: 1,
      purchasedTerminalCount: 1,
      devicePrice: 10,
      terminalPrice: 14,
      deviceDailyPrice: Number((10 / 7).toFixed(4)),
      terminalDailyPrice: 2,
      purchaseAmount: 24,
      registrationToken: {
        id: "rtok-existing",
        entitlementId: "ent-existing",
        token: "rtm_existing_token",
        label: "default",
        expiresAt: null,
        lastUsedAt: null,
        status: MANAGED_STATUS.ENABLED,
        createTime: now,
        updateTime: now,
      },
    };

    const updatedEntitlement = {
      ...existingEntitlement,
      endAt: new Date("2026-06-23T12:00:00.000Z"),
      purchaseUnits: 3,
      durationDays: 19,
      purchaseAmount: 48,
    };

    productRepository.findTemplateById.mockResolvedValue(weeklyTemplate);
    productRepository.findEntitlementById.mockResolvedValue(existingEntitlement);
    productRepository.purchaseAndUpdateEntitlement.mockResolvedValue(updatedEntitlement);

    await service.claimPublishedTemplate(
      {
        templateId: "tpl-1",
        targetEntitlementId: "ent-existing",
        purchaseUnits: 1,
        deviceCount: 1,
        terminalCount: 1,
      },
      "user-1",
    );

    expect(productRepository.purchaseAndUpdateEntitlement).toHaveBeenCalledWith(
      expect.objectContaining({
        entitlementId: "ent-existing",
        entitlement: expect.objectContaining({
          billingUnit: "week",
          purchaseUnits: 3,
          durationDays: 19,
        }),
      }),
    );
    expect(productRepository.purchaseAndUpdateEntitlement).not.toHaveBeenCalledWith(
      expect.objectContaining({
        entitlement: expect.objectContaining({
          purchaseUnits: 6,
        }),
      }),
    );
  });

  it("preserves existing label and expiration when rotating token with empty payload", async () => {
    const expiresAt = new Date("2026-07-01T00:00:00.000Z");
    productRepository.findEntitlementById.mockResolvedValue({
      id: "ent-1",
      userId: "user-1",
      name: "Starter Remote",
      deviceLimit: 2,
      status: MANAGED_STATUS.ENABLED,
      registrationToken: {
        id: "rtok-1",
        entitlementId: "ent-1",
        token: "rtm_old_token",
        label: "persistent label",
        expiresAt,
      },
    });
    productRepository.upsertEntitlementToken.mockResolvedValue({
      id: "rtok-1",
      entitlementId: "ent-1",
      token: "rtm_new_token",
      label: "persistent label",
      expiresAt,
      lastUsedAt: null,
      status: MANAGED_STATUS.ENABLED,
      createTime: now,
      updateTime: now,
    });

    const result = await service.rotateRegistrationToken("ent-1", {}, "admin-1");

    expect(productRepository.upsertEntitlementToken).toHaveBeenCalledWith(
      "ent-1",
      expect.objectContaining({
        entitlementId: "ent-1",
        label: "persistent label",
        expiresAt,
        status: MANAGED_STATUS.ENABLED,
        token: expect.stringMatching(/^rtm_/),
      }),
    );
    expect(result.label).toBe("persistent label");
    expect(result.expiresAt?.toISOString()).toBe(expiresAt.toISOString());
    expect(businessLogService.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: OperationType.REMOTE_TERMINAL_REGISTRATION_TOKEN_ROTATE,
        actorUserId: "admin-1",
        targetUserId: "user-1",
        success: true,
      }),
    );
  });

  it("rejects rotating another user's registration token from current-user route", async () => {
    productRepository.findEntitlementById.mockResolvedValue({
      id: "ent-1",
      userId: "owner-1",
      name: "Starter Remote",
      deviceLimit: 1,
      status: MANAGED_STATUS.ENABLED,
      registrationToken: null,
    });

    await expect(service.rotateCurrentUserRegistrationToken("user-1", "ent-1", {})).rejects.toThrow(ForbiddenError);

    expect(productRepository.upsertEntitlementToken).not.toHaveBeenCalled();
  });
});
