import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/users/iam-account-principal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/users/iam-account-principal")>()),
  IamAccountUserRepository: { getInstance: vi.fn() },
}));
import { env } from "@/config/env";
import { isIamActionResourceCompatible, getIamActionDefinition } from "@quyan/shared";
import { MonthlyPassPurchaseIamService } from "@/services/billing/monthly-pass-purchase-iam.service";
import { monthlyPassPurchaseResources } from "@/iam/request/monthly-pass-purchase-resource-resolvers";
import { monthlyPassTemplateArn, monthlyPassAssignmentArn } from "@/iam/resources/monthly-pass-resources";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  action = "quyan:monthly_pass:ClaimPublishedTemplate";
const iam = { authorize: vi.fn(), loadPolicies: vi.fn() },
  repository = { findTemplateById: vi.fn() },
  users = { targets: vi.fn() };
const authority = new MonthlyPassPurchaseIamService(iam, repository, users);
const req = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "fake:*" },
    body: { templateId: "template", accountId: "attacker" },
    ip: "192.0.2.8",
    secure: true,
  }) as unknown as TypedRequest;
const prepared = () => authority.prepare("actor", req(), "template");
let denied: Set<string>;
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  denied = new Set();
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorize.mockImplementation(async ({ resource }) => ({
    decision: denied.has(resource) ? "ExplicitDeny" : "Allow",
    reason: "fixture",
    matchedStatements: [],
  }));
  repository.findTemplateById.mockResolvedValue({
    id: "template",
    status: 1,
    publishStatus: "published",
    allowBalanceRedemption: true,
    quotaWindows: [],
  });
  users.targets.mockResolvedValue([
    { id: "actor", updateTime: new Date(0) },
    { id: "owner", updateTime: new Date(0) },
  ]);
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("monthly pass purchase capabilities", () => {
  it("declares a fixed Action and evaluates self-parent, template and generated pass resources", async () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/billing/monthly-pass.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "POST /v1/monthly-passes/me/claim",
      ),
    ).toMatchObject({ coverage: "explicit", actions: [action], resourceKind: "batch" });
    expect(getIamActionDefinition(action)).toMatchObject({ defaultAuthorizationScope: "self" });
    const source = await prepared();
    await source!.guard.recheckEntry("pass");
    expect(iam.authorize.mock.calls.every(([input]) => input.action === action)).toBe(true);
    expect(isIamActionResourceCompatible(action, monthlyPassAssignmentArn("owner", "actor", "pass"))).toBe(true);
  });
  it("ignores account and Action overrides in business input", async () => {
    expect(
      await monthlyPassPurchaseResources({
        request: req(),
        principal: { accountOwnerId: "owner", subjectUserId: "actor" } as never,
      }),
    ).toEqual(["acs:quyan:*:owner:user/actor", monthlyPassTemplateArn("owner", "actor", "template")]);
    const bad = { ...req(), body: { templateId: "../invalid" } } as unknown as TypedRequest;
    expect(await monthlyPassPurchaseResources({ request: bad, principal: {} as never })).toBeUndefined();
  });
  it.each(["acs:quyan:*:owner:user/actor", monthlyPassTemplateArn("owner", "actor", "template")])(
    "denies %s before reading the template",
    async (resource) => {
      denied.add(resource);
      await expect(prepared()).rejects.toMatchObject({ statusCode: 403 });
      expect(repository.findTemplateById).not.toHaveBeenCalled();
    },
  );
  it("requires the generated pass to be allowed at commit", async () => {
    const source = await prepared();
    denied.add(monthlyPassAssignmentArn("owner", "actor", "pass"));
    await expect(source!.guard.recheckEntry("pass")).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects inactive, mismatched or unpublished templates", async () => {
    repository.findTemplateById.mockResolvedValue({
      id: "other",
      status: 1,
      publishStatus: "published",
      allowBalanceRedemption: true,
      quotaWindows: [],
    });
    await expect(prepared()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects mutated template snapshots and missing authenticated context", async () => {
    const source = await prepared();
    source!.template.defaultQuota = 999 as never;
    await expect(source!.guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
    await expect(authority.prepare("actor", undefined, "template")).rejects.toMatchObject({ statusCode: 403 });
  });
  it("keeps legacy writes and shadow enforcement boundaries", async () => {
    env.security.iamAuthorizationMode = "legacy";
    expect(await prepared()).toBeUndefined();
    expect(iam.authorize).not.toHaveBeenCalled();
    env.security.iamAuthorizationMode = "shadow";
    denied.add(monthlyPassTemplateArn("owner", "actor", "template"));
    expect(await prepared()).toBeUndefined();
  });
});
