import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  findFirst: vi.fn().mockResolvedValue(null),
  findMany: vi.fn<(args: any) => Promise<any[]>>().mockResolvedValue([]),
}));
vi.mock("@/config/database", () => ({
  prisma: { errorGroup: { findFirst: mocks.findFirst, findMany: mocks.findMany } },
}));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return { iamAccountDenied: () => new ForbiddenError("fixture denied") };
});
import { PlatformErrorGroupReadRepository } from "@/store/system/platform-error-group-read.repository";
describe("error group authorization metadata", () => {
  it("loads only active identity and revision", async () => {
    await PlatformErrorGroupReadRepository.getInstance().target("group-id");
    expect(mocks.findFirst).toHaveBeenCalledExactlyOnceWith({
      where: { id: "group-id", status: 1 },
      select: { id: true, status: true, updateTime: true },
    });
  });
  it.each(["../group", "", "group/id"])("rejects invalid identifier %s", (id) => {
    mocks.findFirst.mockClear();
    expect(() => PlatformErrorGroupReadRepository.getInstance().target(id)).toThrow();
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
  it("scans only identities and revisions using the original predicates and keyset bounds", async () => {
    const after = { id: "group-a", lastSeenAt: new Date("2020-01-01") };
    await PlatformErrorGroupReadRepository.getInstance().scan(
      { page: 2, pageSize: 10, source: "frontend", search: "fixture" },
      after,
      after,
    );
    const args = mocks.findMany.mock.calls[0][0];
    expect(args.where.AND[0]).toMatchObject({ status: 1, source: "frontend", OR: expect.any(Array) });
    expect(args.where.AND[1]).toEqual({
      OR: [{ lastSeenAt: { lt: after.lastSeenAt } }, { lastSeenAt: after.lastSeenAt, id: { lt: after.id } }],
    });
    expect(args.where.AND[2]).toEqual({
      OR: [{ lastSeenAt: { lt: after.lastSeenAt } }, { lastSeenAt: after.lastSeenAt, id: { lte: after.id } }],
    });
    expect(args.select).toEqual({ id: true, status: true, updateTime: true, lastSeenAt: true });
    expect(args).not.toHaveProperty("skip");
  });
  it("hydrates only authorized active revisions and rejects duplicate or invalid targets", async () => {
    mocks.findMany.mockClear();
    const repository = PlatformErrorGroupReadRepository.getInstance();
    expect(await repository.hydrate([])).toEqual([]);
    expect(mocks.findMany).not.toHaveBeenCalled();
    const target = { id: "group-a", status: 1, updateTime: new Date(0), lastSeenAt: new Date(1) };
    await repository.hydrate([target]);
    expect(mocks.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { status: 1, OR: [{ id: target.id, lastSeenAt: target.lastSeenAt, updateTime: target.updateTime }] },
    });
    await expect(repository.hydrate([target, target])).rejects.toThrow();
    await expect(repository.hydrate([{ ...target, status: -1 }])).rejects.toThrow();
    await expect(repository.hydrate([{ ...target, lastSeenAt: new Date("invalid") }])).rejects.toThrow();
  });
});
