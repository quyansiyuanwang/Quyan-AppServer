import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/users/iam-account-principal", () => ({
  IamAccountUserRepository: { getInstance: vi.fn() },
  iamAccountDenied: () => Object.assign(new Error("fixture denied"), { statusCode: 403 }),
}));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { TerminalPurchaseIamService } from "@/services/remote-terminal/terminal-purchase-iam.service";
import { terminalPurchaseResource } from "@/iam/request/terminal-purchase-resource-resolver";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import {
  IAM_AUTHENTICATED_SELF_ACTIONS,
  getIamActionDefinition,
  authenticatedSelfResourcePatterns,
  isIamActionResourceCompatible,
  type IamPrincipal,
} from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const iam = { authorize: vi.fn(), loadPolicies: vi.fn() },
  repository = { template: vi.fn(), target: vi.fn(), purchase: vi.fn() },
  users = { targets: vi.fn() };
const service = new TerminalPurchaseIamService(iam, repository, users);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "client:Fake" },
    body: { templateId: "template", accountId: "untrusted" },
    secure: true,
    ip: "192.0.2.42",
  }) as unknown as TypedRequest;
const mode = env.security.iamAuthorizationMode;
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.authorize.mockResolvedValue({ decision: "Allow", reason: "matched-allow", matchedStatements: [] });
  iam.loadPolicies.mockResolvedValue([]);
  users.targets.mockResolvedValue(["owner", "actor"].map((id) => ({ id, updateTime: new Date(0) })));
  repository.template.mockResolvedValue({ id: "template", status: 1, publishStatus: "published", devicePrice: 1 });
  repository.target.mockResolvedValue({ id: "entry", userId: "actor", templateId: "template", status: 1 });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("terminal purchase authority", () => {
  it("registers the concrete purchase route and a per-identity published offer", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/remote-terminal/remote-terminal-product.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (r) => r.key === "POST /v1/remote-terminal/products/me/entitlements/claim",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:remote_terminal:ClaimPublishedTemplate"], issues: [] });
    expect(getIamActionDefinition("quyan:remote_terminal:ClaimPublishedTemplate")).toMatchObject({
      defaultAuthorizationScope: "self",
      resourceTypes: ["quyan/user", "remote-terminal/published-template", "remote-terminal/product-entitlement"],
    });
    expect(
      isIamActionResourceCompatible(
        "quyan:remote_terminal:ClaimPublishedTemplate",
        "acs:platform:*:platform:remote-terminal-template/template",
      ),
    ).toBe(false);
  });
  it("fixes the purchasing identity from authentication regardless of client account or action", async () => {
    expect(
      await terminalPurchaseResource({
        request: request(),
        principal: { accountOwnerId: "owner", subjectUserId: "actor" } as IamPrincipal,
      }),
    ).toBe("acs:remote-terminal:*:owner:published-template/actor/template");
  });
  it("self baseline covers own offers and entitlements without peer or global template authority", () => {
    const document = parseIamPolicy({
      Version: "1" as const,
      Statement: {
        Effect: "Allow" as const,
        Action: [...IAM_AUTHENTICATED_SELF_ACTIONS],
        Resource: authenticatedSelfResourcePatterns("owner", "actor"),
      },
    }).document;
    for (const resource of [
      "acs:remote-terminal:*:owner:published-template/actor/template",
      "acs:remote-terminal:*:owner:product-entitlement/actor/entry",
    ])
      expect(
        evaluatePolicies([{ policyId: "fixture", document }], {
          action: "quyan:remote_terminal:ClaimPublishedTemplate",
          resource,
        }).decision,
      ).toBe("Allow");
    for (const resource of [
      "acs:remote-terminal:*:owner:published-template/peer/template",
      "acs:remote-terminal:*:other:product-entitlement/actor/entry",
      "acs:platform:*:platform:remote-terminal-template/template",
    ])
      expect(
        evaluatePolicies([{ policyId: "fixture", document }], {
          action: "quyan:remote_terminal:ClaimPublishedTemplate",
          resource,
        }).decision,
      ).toBe("ImplicitDeny");
  });
  it("requires user, published offer, and existing or generated entitlement", async () => {
    const source = (await service.prepare("actor", request(), "template", "entry"))!;
    await source.guard.recheckEntry("entry");
    expect(new Set(iam.authorize.mock.calls.map(([input]) => input.resource))).toEqual(
      new Set([
        "acs:quyan:*:owner:user/actor",
        "acs:remote-terminal:*:owner:published-template/actor/template",
        "acs:remote-terminal:*:owner:product-entitlement/actor/entry",
      ]),
    );
  });
  it("rejects offer denial before template hydration", async () => {
    iam.authorize.mockImplementation(async ({ resource }) => ({
      decision: resource.includes("published-template") ? "ExplicitDeny" : "Allow",
    }));
    await expect(service.prepare("actor", request(), "template")).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.template).not.toHaveBeenCalled();
  });
  it("rejects an entitlement owned by another identity", async () => {
    repository.target.mockResolvedValue({ id: "entry", userId: "peer", templateId: "template", status: 1 });
    await expect(service.prepare("actor", request(), "template", "entry")).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["template", "target"])("binds the %s snapshot into the commit guard", async (kind) => {
    const source = (await service.prepare("actor", request(), "template", "entry"))!;
    if (kind === "template") Object.assign(source.guard.template, { devicePrice: 4 });
    else source.guard.target!.userId = "peer";
    await expect(source.guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails closed when authorization becomes unavailable after planning", async () => {
    const source = (await service.prepare("actor", request(), "template"))!;
    iam.authorize.mockRejectedValue(new Error("unavailable"));
    await expect(source.guard.recheckEntry("generated")).rejects.toThrow("unavailable");
  });
  it("keeps shadow comparison separate from purchase writes", async () => {
    env.security.iamAuthorizationMode = "shadow";
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny" });
    expect(await service.prepare("actor", request(), "template")).toBeUndefined();
    expect(repository.purchase).not.toHaveBeenCalled();
  });
  it.each(["shadow", "enforce"] as const)("rejects absent request in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    await expect(service.prepare("actor", undefined, "template")).rejects.toMatchObject({ statusCode: 403 });
  });
});
