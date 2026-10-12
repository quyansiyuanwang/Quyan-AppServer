import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/support/support-config.repository", () => ({ SupportConfigRepository: { getInstance: vi.fn() } }));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    IamAccountUserRepository: { getInstance: vi.fn() },
    iamAccountDenied: () =>
      new ForbiddenError("fixture unavailable", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { SupportConfigIamService } from "@/services/support/support-config-iam.service";
import { supportConfigResourceResolver } from "@/iam/request/support-config-resource-resolver";
import { getIamActionDefinition } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
let iam: any, repo: any, service: SupportConfigIamService, request: TypedRequest;
beforeEach(() => {
  iam = {
    loadPolicies: vi.fn().mockResolvedValue([]),
    authorize: vi.fn().mockResolvedValue({ decision: "Allow", reason: "matched-allow", matchedStatements: [] }),
  };
  repo = {
    groupSnapshot: vi.fn().mockResolvedValue({ id: "global", updateTime: new Date(0) }),
    snapshot: vi.fn().mockResolvedValue([]),
    recheck: vi.fn(),
    update: vi.fn(),
  };
  service = new (SupportConfigIamService as unknown as new (...args: any[]) => SupportConfigIamService)(iam, repo, {
    targets: vi
      .fn()
      .mockImplementation(async (_: any, ids: string[]) => ids.map((id) => ({ id, updateTime: new Date(0) }))),
  });
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    body: { accountId: "foreign" },
  } as unknown as TypedRequest;
});
describe("support configuration IAM", () => {
  it("declares separate operations on a fixed platform resource", async () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/support/support.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const [verb, action] of [
      ["GET", "quyan:support:GetConfig"],
      ["POST", "quyan:support:UpdateConfig"],
    ]) {
      expect(getIamActionDefinition(action)).toMatchObject({
        sensitive: true,
        authorizationBoundary: "platform",
        resourceTypes: ["platform/config"],
      });
      expect(routes.find((r) => r.key === verb + " /v1/support/config")).toMatchObject({
        coverage: "explicit",
        actions: [action],
        issues: [],
      });
    }
    expect(
      await supportConfigResourceResolver({
        request,
        principal: {
          subjectUserId: "actor",
          principalUserId: "actor",
          accountOwnerId: "owner",
          subjectType: "sub_user",
        },
      }),
    ).toBe("acs:platform:*:platform:config/support-ai");
    const guard = await service.prepare("quyan:support:UpdateConfig", "actor", request);
    expect(guard.users.users.map((u) => u.id).sort()).toEqual(["actor", "owner"]);
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ resource: "acs:platform:*:platform:config/support-ai" }),
    );
  });
  it("does not read configuration values on Deny and rechecks current policy", async () => {
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny" });
    await expect(service.prepare("quyan:support:GetConfig", "actor", request)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repo.snapshot).not.toHaveBeenCalled();
    iam.authorize.mockResolvedValue({ decision: "Allow" });
    const guard = await service.prepare("quyan:support:GetConfig", "actor", request);
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny" });
    await expect(guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects missing identity, mismatched caller and OAuth tokens", async () => {
    await expect(service.prepare("quyan:support:GetConfig", "actor")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.prepare("quyan:support:GetConfig", "foreign", request)).rejects.toMatchObject({
      statusCode: 403,
    });
    request.oauthAccessToken = { id: "token" } as any;
    await expect(service.prepare("quyan:support:GetConfig", "actor", request)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
