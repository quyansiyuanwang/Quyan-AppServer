import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationWebhookIamService } from "@/services/notification/notification-webhook-iam.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { iamAuthenticatedUserResourceResolver } from "@/iam/request/resource-resolvers";
import type { TypedRequest } from "@/types/express";
vi.mock("@/iam/iam-authorization.service");
vi.mock("@/store/notification/notification-webhook-management.repository");
vi.mock("@/services/notification/notification-preference-initializer.service");
vi.mock("@/iam/request/principal-context");
vi.mock("@/iam/request/resource-resolvers");
vi.mock("@/iam/request/condition-context", () => ({ requestConditionContext: () => ({}) }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
const principal = {
  subjectUserId: "actor",
  principalUserId: "actor",
  accountOwnerId: "owner",
  subjectType: "sub_user" as const,
};
const input = { name: "Hook", url: "https://example.invalid/webhook", format: "generic" };
const allowed = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
const denied = { decision: "ImplicitDeny", reason: "no-matching-allow", matchedStatements: [] };
const row = { id: "hook", userId: "actor" };
let iam: any, repository: any, initializer: any, service: NotificationWebhookIamService, request: TypedRequest;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getIamPrincipal).mockReturnValue(principal);
  vi.mocked(iamAuthenticatedUserResourceResolver).mockReturnValue("acs:quyan:*:owner:user/actor");
  iam = { loadPolicies: vi.fn().mockResolvedValue([]), authorizeMany: vi.fn().mockResolvedValue([allowed]) };
  repository = {
    assertPrincipal: vi.fn().mockResolvedValue(undefined),
    scan: vi.fn().mockResolvedValue([]),
    hydrate: vi.fn().mockResolvedValue([]),
    target: vi.fn().mockResolvedValue(row),
    create: vi.fn().mockResolvedValue({ hasSecret: false }),
    update: vi.fn().mockResolvedValue({ hasSecret: false }),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  initializer = { getInitializationDefaults: vi.fn().mockResolvedValue({}) };
  service = new (NotificationWebhookIamService as any)(iam, repository, initializer);
  request = { params: {}, headers: {}, user: { userId: "actor" } } as unknown as TypedRequest;
});
describe("Webhook IAM fail-closed boundary", () => {
  it("requires matching executing identity even for an empty collection", async () => {
    await expect(service.list("actor")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.list("peer", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.scan).not.toHaveBeenCalled();
  });
  it("checks live identity on an empty collection", async () => {
    expect(await service.list("actor", request)).toEqual([]);
    expect(repository.assertPrincipal).toHaveBeenCalledWith(principal);
  });
  it("does not initialize preferences or persist when create is denied", async () => {
    iam.authorizeMany.mockResolvedValue([denied]);
    await expect(service.create("actor", input, request)).rejects.toMatchObject({ statusCode: 403 });
    expect(initializer.getInitializationDefaults).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });
  it("authorizes the actual target argument and strips internal mutation fields", async () => {
    request.params.id = "forged";
    await service.update(
      "hook",
      "actor",
      { secret: null, userId: "peer", preferenceId: "foreign", status: -1 },
      request,
    );
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:notification:UpdateWebhook",
        resources: ["acs:notification:*:owner:webhook/actor/hook"],
      }),
    );
    expect(repository.update).toHaveBeenCalledWith(principal, row, { secret: null });
  });
  it.each([{ results: [] }, { results: [undefined] }, { results: undefined }])(
    "rejects incomplete authorization results before writes",
    async ({ results }) => {
      iam.authorizeMany.mockResolvedValue(results);
      await expect(service.update("hook", "actor", {}, request)).rejects.toMatchObject({ statusCode: 403 });
      expect(repository.update).not.toHaveBeenCalled();
    },
  );
  it("rechecks selected grants before hydrating content", async () => {
    repository.scan.mockResolvedValue([row]);
    iam.authorizeMany.mockResolvedValueOnce([allowed]).mockResolvedValueOnce([denied]);
    await expect(service.list("actor", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("does not turn policy-store failure into an empty allowed list", async () => {
    iam.loadPolicies.mockRejectedValue(new Error("fixture unavailable"));
    await expect(service.list("actor", request)).rejects.toThrow("fixture unavailable");
    expect(repository.scan).not.toHaveBeenCalled();
  });
});
