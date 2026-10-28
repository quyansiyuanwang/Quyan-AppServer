import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationPreferenceIamService } from "@/services/notification/notification-preference-iam.service";
import type { TypedRequest } from "@/types/express";

vi.mock("@/iam/iam-authorization.service");
vi.mock("@/store/notification/notification-preference-management.repository");
vi.mock("@/services/notification/notification-preference-initializer.service");
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
const iam = { authorize: vi.fn() };
const repository = { update: vi.fn() };
const initializer = { getOrInitializeForAccount: vi.fn() };
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "account", subjectType: "sub_user" },
    params: {},
    body: { userId: "peer", accountOwnerId: "foreign" },
    headers: { "x-action": "quyan:notification:Manage" },
    secure: true,
  }) as unknown as TypedRequest;
let service: NotificationPreferenceIamService;
beforeEach(() => {
  vi.clearAllMocks();
  service = new (NotificationPreferenceIamService as any)(iam, repository, initializer);
  iam.authorize.mockResolvedValue({ decision: "Allow", reason: "matched-allow", matchedStatements: [] });
});
describe("notification preference service authorization boundary", () => {
  it("uses fixed Action and actual self ARN before initialization, ignoring client identity overrides", async () => {
    const req = request();
    initializer.getOrInitializeForAccount.mockResolvedValue({ id: "preference" });
    await service.get("actor", req);
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:notification:GetPreferences",
        resource: "acs:quyan:*:account:user/actor",
      }),
    );
    expect(iam.authorize.mock.invocationCallOrder[0]).toBeLessThan(
      initializer.getOrInitializeForAccount.mock.invocationCallOrder[0],
    );
    expect(req.iamDecisions).toEqual([
      expect.objectContaining({ decision: "Allow", action: "quyan:notification:GetPreferences" }),
    ]);
  });
  it.each(["ImplicitDeny", "ExplicitDeny"])("does not initialize or mutate for %s", async (decision) => {
    iam.authorize.mockResolvedValue({ decision, reason: "denied", matchedStatements: [] });
    await expect(service.get("actor", request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.update("actor", {}, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(initializer.getOrInitializeForAccount).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });
  it.each(["missing", "mismatch", "principal-mismatch", "invalid-resource"])(
    "rejects %s identity before reading grants or writing",
    async (caseName) => {
      const req = request();
      if (caseName === "missing") delete req.authContext;
      if (caseName === "principal-mismatch") req.authContext!.principalUserId = "peer";
      if (caseName === "invalid-resource") {
        req.user!.userId = "bad/id";
        req.authContext!.principalUserId = "bad/id";
      }
      const actor = caseName === "mismatch" ? "peer" : caseName === "invalid-resource" ? "bad/id" : "actor";
      await expect(service.get(actor, req)).rejects.toMatchObject({ statusCode: 403 });
      expect(iam.authorize).not.toHaveBeenCalled();
      expect(initializer.getOrInitializeForAccount).not.toHaveBeenCalled();
    },
  );
  it("fails closed without request context or when the policy store fails", async () => {
    await expect(service.get("actor")).rejects.toMatchObject({ statusCode: 403 });
    iam.authorize.mockRejectedValue(new Error("fixture store unavailable"));
    await expect(service.update("actor", {}, request())).rejects.toThrow("fixture store unavailable");
    expect(repository.update).not.toHaveBeenCalled();
  });
  it("normalizes independent internal update calls and forwards only writable preference fields", async () => {
    await service.update(
      "actor",
      { cooldownMinutes: 30, status: 0, knownEvents: ["forged"], userId: "peer" },
      request(),
    );
    expect(repository.update).toHaveBeenCalledWith(expect.objectContaining({ subjectUserId: "actor" }), {
      cooldownMinutes: 30,
    });
    await expect(service.update("actor", { cooldownMinutes: -1 }, request())).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(repository.update).toHaveBeenCalledTimes(1);
  });
});
