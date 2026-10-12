import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), guard: vi.fn() }));
vi.mock("@/config/database", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/store/users/iam-account-user-mutation", () => ({ assertIamAccountUserMutation: mocks.guard }));
vi.mock("@/store/oj-submitter/oj-apikey-management.repository", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    ojApiKeyDenied: () =>
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { OjApiKeyMutationRepository } from "@/store/oj-submitter/oj-apikey-mutation.repository";
describe("OJ API Key disclosure query boundary", () => {
  it.each([false, true])("selects the credential column only when canReveal is %s", async (reveal) => {
    vi.clearAllMocks();
    const findFirst = vi
        .fn()
        .mockResolvedValue({
          id: "key",
          userId: "actor",
          name: "new",
          channel: { name: "fixture" },
          key: "fixture-secret",
        }),
      updateMany = vi.fn().mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) =>
      callback({ oJAPIKey: { updateMany, findFirst } }),
    );
    const result = await OjApiKeyMutationRepository.getInstance().update(
      { name: "new" },
      {
        target: { id: "key", userId: "actor", status: 1, updateTime: new Date(0), createTime: new Date(0) },
        identity: {
          principal: {
            subjectUserId: "actor",
            principalUserId: "actor",
            accountOwnerId: "owner",
            subjectType: "sub_user",
          },
          targetUserId: "actor",
          users: [],
          recheck: vi.fn(),
        },
        canReveal: vi.fn().mockResolvedValue(reveal),
      },
    );
    expect(findFirst.mock.calls[0][0].select.key).toBe(reveal ? true : undefined);
    expect(findFirst.mock.calls[0][0].select.channel).toEqual({ select: { name: true } });
    expect(result.key).toBe(reveal ? "fixture-secret" : undefined);
    expect(mocks.guard).toHaveBeenCalledTimes(2);
  });
});
