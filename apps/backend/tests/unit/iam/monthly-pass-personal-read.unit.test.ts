import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/users/iam-account-principal", () => ({
  IamAccountUserRepository: { getInstance: vi.fn() },
  iamAccountDenied: () => Object.assign(new Error("fixture denied"), { statusCode: 403 }),
}));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { MonthlyPassPersonalReadIamService } from "@/services/billing/monthly-pass-personal-read-iam.service";
import { getIamActionDefinition } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const iam = { authorizeMany: vi.fn(), loadPolicies: vi.fn() },
  repository = { list: vi.fn() },
  users = { targets: vi.fn() },
  legacy = vi.fn();
const service = new MonthlyPassPersonalReadIamService(iam, repository, users),
  mode = env.security.iamAuthorizationMode;
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: {},
    secure: true,
    ip: "192.0.2.42",
  }) as unknown as TypedRequest;
const read = (req: TypedRequest | undefined = request()) =>
  service.list("actor", req, { page: 1, pageSize: 10 }, undefined, (view) => view.record.id, legacy);
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "matched-allow", matchedStatements: [] })),
  );
  iam.loadPolicies.mockResolvedValue([]);
  users.targets.mockResolvedValue(["actor", "owner"].map((id) => ({ id, updateTime: new Date(0) })));
  repository.list.mockImplementation(async (principal, _pagination, _status, decide, recheck) => {
    await recheck();
    await decide(["acs:monthly-pass:*:owner:assignment/actor/entry"]);
    return { total: 1, records: [{ record: { id: "entry", userId: principal.subjectUserId } }] };
  });
  legacy.mockResolvedValue({ total: 0, records: [] });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("personal monthly pass collection", () => {
  it("declares collection admission and primary plus optional contributing resource types", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/billing/monthly-pass.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find((r) => r.key === "GET /v1/monthly-passes/me"),
    ).toMatchObject({
      coverage: "explicit",
      resourceKind: "collection",
      actions: ["quyan:monthly_pass:ListMyPasses"],
      issues: [],
    });
    expect(getIamActionDefinition("quyan:monthly_pass:ListMyPasses")).toMatchObject({
      defaultAuthorizationScope: "self",
    });
    expect(getIamActionDefinition("quyan:monthly_pass:ListMyPasses")!.resourceTypes).toContain("monthly-pass/usage");
  });
  it("passes trusted identity and the shared decision protocol into resource filtering", async () => {
    expect(await read()).toMatchObject({ total: 1, records: ["entry"] });
    expect(legacy).not.toHaveBeenCalled();
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:monthly_pass:ListMyPasses",
        principal: expect.objectContaining({ accountOwnerId: "owner", subjectUserId: "actor" }),
      }),
    );
  });
  it("rejects foreign rows from a compromised read adapter", async () => {
    repository.list.mockResolvedValue({ total: 1, records: [{ record: { id: "entry", userId: "peer" } }] });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects incomplete batch decision results", async () => {
    iam.authorizeMany.mockResolvedValue([]);
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks changed authorization before exposing data", async () => {
    repository.list.mockImplementation(async () => {
      iam.loadPolicies.mockRejectedValue(new Error("unavailable"));
      return { total: 1, records: [{ record: { id: "entry", userId: "actor" } }] };
    });
    await expect(read()).rejects.toThrow("unavailable");
  });
  it("returns legacy output when shadow evaluation denies but never uses it in enforce", async () => {
    env.security.iamAuthorizationMode = "shadow";
    repository.list.mockRejectedValue(new Error("denied"));
    expect(await read()).toEqual({ total: 0, records: [] });
    expect(legacy).toHaveBeenCalledOnce();
  });
  it.each(["shadow", "enforce"] as const)("refuses absent context in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    await expect(
      service.list("actor", undefined, { page: 1, pageSize: 10 }, undefined, (view) => view.record.id, legacy),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
