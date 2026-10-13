import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findFirst: vi.fn().mockResolvedValue(null) }));
vi.mock("@/config/database", () => ({ prisma: { errorGroup: { findFirst: mocks.findFirst } } }));
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
});
