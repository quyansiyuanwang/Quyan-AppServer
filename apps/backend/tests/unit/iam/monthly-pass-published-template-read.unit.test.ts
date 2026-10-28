import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/users/iam-account-principal", () => ({
  IamAccountUserRepository: { getInstance: vi.fn() },
  iamAccountDenied: () => Object.assign(new Error("fixture denied"), { statusCode: 403 }),
}));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { MonthlyPassPublishedTemplateReadIamService } from "@/services/billing/monthly-pass-published-template-read-iam.service";
import { getIamActionDefinition } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  repository = { list: vi.fn() },
  users = { targets: vi.fn() },
  legacy = vi.fn();
const service = new MonthlyPassPublishedTemplateReadIamService(iam, repository, users),
  mode = env.security.iamAuthorizationMode;
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "client:Fake" },
    secure: true,
  }) as unknown as TypedRequest;
const read = (req = request()) => service.list(req, (row) => row.id, legacy);
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "matched-allow", matchedStatements: [] })),
  );
  users.targets.mockResolvedValue(["actor", "owner"].map((id) => ({ id, updateTime: new Date(0) })));
  repository.list.mockImplementation(async (_principal, decide, recheck) => {
    await recheck();
    await decide(["acs:monthly-pass:*:owner:template/actor/offer"]);
    return [{ id: "offer", status: 1, publishStatus: "published" }];
  });
  legacy.mockResolvedValue(["legacy"]);
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("personal published monthly pass offers", () => {
  it("declares collection filtering and a self baseline restricted to offers", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/billing/monthly-pass.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "GET /v1/monthly-passes/templates/published",
      ),
    ).toMatchObject({
      coverage: "explicit",
      resourceKind: "collection",
      actions: ["quyan:monthly_pass:ListPublishedTemplates"],
      issues: [],
    });
    expect(getIamActionDefinition("quyan:monthly_pass:ListPublishedTemplates")).toMatchObject({
      defaultAuthorizationScope: "self",
      resourceTypes: ["monthly-pass/template"],
    });
  });
  it("takes action and account identity only from server metadata", async () => {
    expect(await read()).toEqual(["offer"]);
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:monthly_pass:ListPublishedTemplates",
        principal: expect.objectContaining({ subjectUserId: "actor", accountOwnerId: "owner" }),
      }),
    );
    expect(legacy).not.toHaveBeenCalled();
  });
  it("fails closed on missing authentication and unsupported mode", async () => {
    await expect(service.list(undefined, (row) => row.id, legacy)).rejects.toMatchObject({ statusCode: 403 });
    const missing = request();
    missing.authContext = undefined;
    await expect(read(missing)).rejects.toMatchObject({ statusCode: 403 });
    env.security.iamAuthorizationMode = "unknown" as typeof mode;
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).not.toHaveBeenCalled();
  });
  it("rejects identity changes through the read boundary", async () => {
    users.targets
      .mockResolvedValueOnce(["actor", "owner"].map((id) => ({ id, updateTime: new Date(0) })))
      .mockResolvedValue([
        { id: "actor", updateTime: new Date(1) },
        { id: "owner", updateTime: new Date(0) },
      ]);
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.list).not.toHaveBeenCalled();
  });
  it("rejects unpublished results and malformed evaluation responses", async () => {
    repository.list.mockResolvedValue([{ id: "draft", status: 1, publishStatus: "draft" }]);
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    repository.list.mockImplementation(async (_p, decide) => {
      await decide(["acs:monthly-pass:*:owner:template/actor/offer"]);
      return [];
    });
    iam.authorizeMany.mockResolvedValue([]);
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("keeps legacy and shadow enforcement explicit", async () => {
    env.security.iamAuthorizationMode = "legacy";
    expect(await read()).toEqual(["legacy"]);
    expect(repository.list).not.toHaveBeenCalled();
    env.security.iamAuthorizationMode = "shadow";
    repository.list.mockRejectedValue(new Error("fixture denied"));
    expect(await read()).toEqual(["legacy"]);
    expect(repository.list).toHaveBeenCalledTimes(1);
  });
});
