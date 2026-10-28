import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveBusinessLogWhere } from "@/store/system/businesslog-query";
import type { Prisma } from "@prisma/client";
const findMany = vi.fn(),
  client = { user: { findMany } } as unknown as Pick<Prisma.TransactionClient, "user">;
beforeEach(() => findMany.mockResolvedValue([{ id: "actor" }, { id: "target" }]));
describe("one business log predicate for all readers", () => {
  it("does not impose an implicit date range and retains false success", async () => {
    expect(await resolveBusinessLogWhere(client, { success: false })).toEqual({ status: 1, success: false });
  });
  it("intersects active username results with an explicit ID for actor and target", async () => {
    expect(
      await resolveBusinessLogWhere(client, {
        actor: "name",
        actorUserId: "actor",
        target: "other",
        targetUserId: "target",
      }),
    ).toEqual({ status: 1, actorUserId: "actor", targetUserId: "target" });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 1 }), take: 100 }),
    );
    expect(await resolveBusinessLogWhere(client, { actor: "name", actorUserId: "absent" })).toBeNull();
    expect(await resolveBusinessLogWhere(client, { target: "other", targetUserId: "absent" })).toBeNull();
  });
  it("resolves username searches once and returns null when no identities match", async () => {
    expect(await resolveBusinessLogWhere(client, { actor: "name", target: "other" })).toEqual({
      status: 1,
      actorUserId: { in: ["actor", "target"] },
      targetUserId: { in: ["actor", "target"] },
    });
    findMany.mockResolvedValue([]);
    expect(await resolveBusinessLogWhere(client, { actor: "unknown" })).toBeNull();
  });
  it.each([
    ["::1", "127.0.0.1"],
    ["::ffff:192.0.2.1", "192.0.2.1"],
    ["192.0.2", "192.0.2"],
  ])("preserves normalized IP text matching for %s", async (ip, expected) => {
    expect(await resolveBusinessLogWhere(client, { ip })).toEqual({ status: 1, ipAddress: { contains: expected } });
  });
  it("keeps explicit one-sided ranges", async () => {
    const startDate = new Date("2026-10-14");
    expect(await resolveBusinessLogWhere(client, { startDate })).toEqual({ status: 1, createTime: { gte: startDate } });
  });
});
