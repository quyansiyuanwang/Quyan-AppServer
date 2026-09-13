import { beforeEach, describe, expect, it, vi } from "vitest";
import { CarpoolService } from "../../../src/services/billing/carpool.service";
import { BadRequestError, ForbiddenError } from "../../../src/util/errors";

const now = new Date("2026-09-13T00:00:00.000Z");

const createPackageRecord = (overrides: Record<string, unknown> = {}) => ({
  id: "package-1",
  name: "Starter carpool",
  description: null,
  salePrice: 120,
  upstreamCost: 72,
  maxMembers: 3,
  formationDeadlineHours: 72,
  monthlyPassTemplateId: "pass-template-1",
  publishStatus: "published",
  snapshotQuota: 900,
  snapshotQuotaUnit: "credits",
  snapshotQuotaWindowHours: 24,
  snapshotValidityDays: 30,
  status: 1,
  createTime: now,
  updateTime: now,
  ...overrides,
});

const createService = (repository: Record<string, unknown>) => {
  const service = new CarpoolService();
  (service as unknown as { repository: Record<string, unknown> }).repository = repository;
  return service;
};

describe("CarpoolService lifecycle guards", () => {
  let repository: Record<string, any>;

  beforeEach(() => {
    repository = {
      findActiveMonthlyPassTemplate: vi.fn(),
      createTemplate: vi.fn(),
      findPublishedTemplates: vi.fn(),
      findTemplates: vi.fn(),
      findOrder: vi.fn(),
      findOrdersForAdmin: vi.fn(),
      withTransaction: vi.fn(),
      findOpenOrdersDueForExpiry: vi.fn(),
      findOpenOrdersMissingFormationDeadline: vi.fn(),
      backfillFormationDeadline: vi.fn(),
      listEligibleDeliveryChannels: vi.fn(),
      findOrderSummary: vi.fn(),
      countAdminOrdersByState: vi.fn(),
    };
  });

  it("snapshots monthly-pass delivery settings and the default 72-hour deadline into a new package", async () => {
    repository.findActiveMonthlyPassTemplate.mockResolvedValue({
      id: "pass-template-1",
      defaultQuota: 900,
      quotaUnit: "credits",
      quotaWindowHours: 24,
      validityDays: 30,
      allowedModels: '["gpt-5"]',
      allowedChannels: '["channel-1"]',
    });
    repository.createTemplate.mockImplementation(async (data: Record<string, unknown>) => createPackageRecord(data));
    const service = createService(repository);

    const result = await service.createTemplate({
      name: "Starter carpool",
      salePrice: 120,
      upstreamCost: 72,
      maxMembers: 3,
      monthlyPassTemplateId: "pass-template-1",
    });

    expect(repository.createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        formationDeadlineHours: 72,
        snapshotQuota: 900,
        snapshotQuotaUnit: "credits",
        snapshotQuotaWindowHours: 24,
        snapshotValidityDays: 30,
        snapshotAllowedModels: '["gpt-5"]',
        snapshotAllowedChannels: '["channel-1"]',
      }),
    );
    expect(result.estimatedSeatPrice).toBe(40);
    expect(result.estimatedSeatCost).toBe(24);
    expect(result.estimatedGrossMargin).toBe(48);
  });

  it("omits operational cost and margin fields from public package catalog responses", async () => {
    const packageRecord = createPackageRecord();
    repository.findPublishedTemplates.mockResolvedValue([packageRecord]);
    repository.findTemplates.mockResolvedValue([1, [packageRecord]]);
    const service = createService(repository);

    const [legacyPublished, catalog, managed] = await Promise.all([
      service.listPublishedTemplates(),
      service.listCatalog(1, 20),
      service.listTemplates(1, 20),
    ]);

    for (const item of [...legacyPublished, ...catalog.records]) {
      expect(item).not.toHaveProperty("upstreamCost");
      expect(item).not.toHaveProperty("estimatedSeatCost");
      expect(item).not.toHaveProperty("estimatedGrossMargin");
    }
    expect(managed.records[0]).toMatchObject({
      upstreamCost: 72,
      estimatedSeatCost: 24,
      estimatedGrossMargin: 48,
    });
  });

  it("backfills only legacy open order deadlines without overwriting a current snapshot", async () => {
    repository.findOpenOrdersMissingFormationDeadline
      .mockResolvedValueOnce([
        { id: "legacy-1", inviteExpiresAt: new Date("2026-09-14T00:00:00.000Z") },
        { id: "legacy-2", inviteExpiresAt: null },
      ])
      .mockResolvedValueOnce([]);
    repository.backfillFormationDeadline.mockResolvedValue({ count: 1 });
    const service = createService(repository);

    await service.backfillOpenOrderFormationDeadlines();

    expect(repository.backfillFormationDeadline).toHaveBeenCalledTimes(1);
    expect(repository.backfillFormationDeadline).toHaveBeenCalledWith("legacy-1", new Date("2026-09-14T00:00:00.000Z"));
  });

  it("returns global workflow statistics with an administrative page", async () => {
    repository.findOrdersForAdmin.mockResolvedValue([0, []]);
    repository.countAdminOrdersByState.mockResolvedValue([
      { state: "submitted", _count: { _all: 3 } },
      { state: "accepted", _count: { _all: 2 } },
    ]);
    const service = createService(repository);

    await expect(service.listAdmin(undefined, 1, 20, "starter")).resolves.toEqual({
      total: 0,
      records: [],
      stateCounts: { submitted: 3, accepted: 2 },
    });
    expect(repository.countAdminOrdersByState).toHaveBeenCalledWith("starter");
  });

  it("uses server pagination bounds and only returns safe Relay delivery-channel fields", async () => {
    repository.listEligibleDeliveryChannels.mockResolvedValue([
      1,
      [{ id: "channel-1", name: "Approved channel", channelType: "openai", apiKey: "must-not-leak" }],
    ]);
    const service = createService(repository);

    const result = await service.listDeliveryChannels(0, 999, "approved");

    expect(repository.listEligibleDeliveryChannels).toHaveBeenCalledWith(1, 100, "approved", undefined);
    expect(result).toEqual({
      total: 1,
      records: [{ id: "channel-1", name: "Approved channel", channelType: "openai" }],
    });
  });

  it("limits delivery-channel choices to the order's immutable channel snapshot", async () => {
    repository.findOrderSummary.mockResolvedValue({
      id: "order-1",
      state: "accepted",
      allowedChannels: '["channel-1"]',
    });
    repository.listEligibleDeliveryChannels.mockResolvedValue([0, []]);
    const service = createService(repository);

    await service.listDeliveryChannels(1, 20, undefined, "order-1");

    expect(repository.listEligibleDeliveryChannels).toHaveBeenCalledWith(1, 20, undefined, ["channel-1"]);
  });

  it("rejects fulfillment with a channel outside the order's immutable snapshot", async () => {
    const tx = {
      carpoolOrder: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "order-1",
          state: "accepted",
          allowedChannels: '["channel-1"]',
          members: [],
          packageTemplate: { monthlyPassTemplateId: "pass-template-1" },
        }),
      },
    };
    repository.withTransaction.mockImplementation((callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx),
    );
    const service = createService(repository);

    await expect(service.fulfill("order-1", "channel-2", "operator-1")).rejects.toBeInstanceOf(BadRequestError);
  });

  it("rejects a custom allocation unless both active-member ratio totals are exactly 100", async () => {
    const tx = {
      carpoolOrder: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "order-1",
          state: "open",
          ownerUserId: "owner-1",
          salePrice: 120,
          totalQuota: 900,
          members: [{ id: "member-1", state: "pending" }],
        }),
      },
    };
    repository.withTransaction.mockImplementation((callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx),
    );
    const service = createService(repository);

    await expect(
      service.allocate(
        "order-1",
        {
          allocationMode: "custom",
          members: [{ memberId: "member-1", paymentRatio: 100, quotaRatio: 99.999 }],
        },
        "owner-1",
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("rebalances equal allocation server-side and ignores client-supplied ratios", async () => {
    const members = [
      { id: "member-1", state: "confirmed" },
      { id: "member-2", state: "pending" },
    ];
    const tx = {
      carpoolOrder: {
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValueOnce({
            id: "order-1",
            state: "open",
            ownerUserId: "owner-1",
            salePrice: 120,
            totalQuota: 900,
            members,
          })
          .mockResolvedValueOnce({ id: "order-1", salePrice: 120, totalQuota: 900 })
          .mockResolvedValueOnce({ id: "order-1" }),
        update: vi.fn(),
      },
      carpoolMember: {
        findMany: vi.fn().mockResolvedValue(members),
        updateMany: vi.fn(),
        update: vi.fn(),
      },
      balanceReservation: { updateMany: vi.fn() },
      carpoolOrderEvent: { create: vi.fn() },
    };
    repository.withTransaction.mockImplementation((callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx),
    );
    const service = createService(repository);
    const dto = vi.fn().mockReturnValue({ id: "order-1" });
    (service as unknown as { dto: typeof dto }).dto = dto;

    await service.allocate(
      "order-1",
      {
        allocationMode: "equal",
        members: [
          { memberId: "member-1", paymentRatio: 99, quotaRatio: 1 },
          { memberId: "member-2", paymentRatio: 1, quotaRatio: 99 },
        ],
      },
      "owner-1",
    );

    expect(tx.balanceReservation.updateMany).toHaveBeenCalledWith({
      where: { orderId: "order-1", state: "reserved" },
      data: { state: "released" },
    });
    expect(tx.carpoolMember.updateMany).toHaveBeenCalledWith({
      where: { orderId: "order-1", state: { not: "left" } },
      data: { state: "pending", confirmedAt: null },
    });
    expect(tx.carpoolMember.update).toHaveBeenCalledTimes(2);
    for (const [call] of tx.carpoolMember.update.mock.calls) {
      expect(Number(call.data.paymentRatio)).toBe(50);
      expect(Number(call.data.quotaRatio)).toBe(50);
      expect(Number(call.data.payableAmount)).toBe(60);
      expect(Number(call.data.finalQuota)).toBe(450);
      expect(call.data).toMatchObject({ state: "pending", confirmedAt: null });
    }
    expect(tx.carpoolOrder.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: { allocationMode: "equal" },
    });
    expect(tx.carpoolOrderEvent.create).toHaveBeenCalledWith({
      data: {
        orderId: "order-1",
        type: "allocation_updated",
        actorUserId: "owner-1",
        metadata: { allocationMode: "equal" },
      },
    });
  });

  it("does not expose an order to users who are not members", async () => {
    repository.findOrder.mockResolvedValue({ members: [{ userId: "member-1" }] });
    const service = createService(repository);

    await expect(service.getOrder("order-1", "outsider-1")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("allows an authorized operator detail request without granting them member actions", async () => {
    const order = { id: "order-1", members: [{ userId: "member-1" }] };
    repository.findOrder.mockResolvedValue(order);
    const service = createService(repository);
    const dto = vi.fn().mockReturnValue({ id: "order-1" });
    (service as unknown as { dto: typeof dto }).dto = dto;

    await expect(service.getOrder("order-1", "operator-1", true)).resolves.toEqual({ id: "order-1" });
    expect(dto).toHaveBeenCalledWith(order, undefined, true);
  });
  it("rechecks state inside the expiry transaction so a previously processed order is not released twice", async () => {
    const tx = {
      carpoolOrder: {
        findUnique: vi.fn().mockResolvedValue({ id: "order-1", state: "expired", formationDeadlineAt: now }),
        update: vi.fn(),
      },
      balanceReservation: { updateMany: vi.fn() },
      carpoolOrderEvent: { create: vi.fn() },
    };
    repository.findOpenOrdersDueForExpiry.mockResolvedValue(["order-1"]);
    repository.withTransaction.mockImplementation((callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx),
    );
    const service = createService(repository);

    await service.expireDueOrders();

    expect(tx.balanceReservation.updateMany).not.toHaveBeenCalled();
    expect(tx.carpoolOrder.update).not.toHaveBeenCalled();
    expect(tx.carpoolOrderEvent.create).not.toHaveBeenCalled();
  });
});
