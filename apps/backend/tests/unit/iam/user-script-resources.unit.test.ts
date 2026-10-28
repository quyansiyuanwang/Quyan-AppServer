import { beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { mockDeep } from "vitest-mock-extended";
import {
  getIamActionDefinition,
  IAM_AUTHENTICATED_SELF_ACTIONS,
  iamActionsForLegacyPermission,
  Permission,
} from "@quyan/shared";
import type { IamEvaluationResult } from "@quyan/shared";
import type { IamAuthorizationService } from "@/iam/iam-authorization.service";
import type { UserScriptRepository } from "@/store/user-script.repository";
import type { TypedRequest } from "@/types/express";

vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/user-script.repository", () => ({ UserScriptRepository: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
import { UserScriptIamService } from "@/services/user-script/user-script-iam.service";
import { userScriptResourceResolver } from "@/iam/request/script-resource-resolvers";
import { UserScriptRepository as Repository } from "@/store/user-script.repository";
import { userScriptArn } from "@/iam/resources/script-resources";

const repository = mockDeep<UserScriptRepository>(),
  iam = mockDeep<IamAuthorizationService>();
const Service = UserScriptIamService as unknown as new (
  repository: UserScriptRepository,
  iam: IamAuthorizationService,
) => UserScriptIamService;
const service = new Service(repository, iam);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: {},
    params: { id: "script-2" },
    query: { accountId: "foreign" },
  }) as unknown as TypedRequest;
const target = (id: string) => ({
  id,
  userId: "actor",
  createTime: new Date("2026-10-12T00:00:00Z"),
  updateTime: new Date("2026-10-12T00:00:00Z"),
});
const allow: IamEvaluationResult = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
const deny: IamEvaluationResult = { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(Repository.getInstance).mockReturnValue(repository);
  iam.loadPolicies.mockResolvedValue([]);
  repository.scanTargets.mockResolvedValue([target("script-3"), target("script-2"), target("script-1")]);
  repository.findTarget.mockResolvedValue(target("script-2"));
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map((resource) => (resource.endsWith("script-2") ? deny : allow)),
  );
  repository.readTargets.mockImplementation(async (_user, _account, targets) =>
    targets.map((row) => ({ ...row, status: 1, name: "fixture", description: null, content: "private body" })),
  );
});

describe("user script resource authorization", () => {
  it("declares all script CRUD routes with server-owned actions and resource resolvers", () => {
    const routes = collectIamRoutes(
      new Project({ skipAddingFilesFromTsConfig: true }).addSourceFilesAtPaths(
        fileURLToPath(new URL("../../../src/api/controllers/v1/user-script/*.ts", import.meta.url)),
      ),
      fileURLToPath(new URL("../../../", import.meta.url)),
    ).filter((route) => route.controller === "UserScriptController");
    expect(routes).toHaveLength(4);
    expect(routes.every((route) => route.coverage === "explicit" && route.issues.length === 0)).toBe(true);
  });
  it("registers real actions with migration aliases but does not grant authenticated-self defaults", () => {
    expect(iamActionsForLegacyPermission(Permission.SCRIPT_CREATE)).toContain("quyan:script:CreateScript");
    expect(iamActionsForLegacyPermission(Permission.SCRIPT_CREATE)).toContain("quyan:script:UpdateScript");
    expect(getIamActionDefinition("quyan:script:UpdateScript")?.resourceTypes).toEqual(["script/script"]);
    expect(IAM_AUTHENTICATED_SELF_ACTIONS).not.toContain("quyan:script:ListScripts");
    expect(userScriptArn("owner", "actor", "script-1")).toBe("acs:script:*:owner:script/actor/script-1");
  });
  it("filters metadata before reading script bodies and ignores the client account", async () => {
    expect((await service.list("actor", request())).map((row) => row.id)).toEqual(["script-3", "script-1"]);
    expect(repository.readTargets).toHaveBeenCalledWith("actor", "owner", [target("script-3"), target("script-1")]);
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:script:ListScripts",
        resources: [
          "acs:script:*:owner:script/actor/script-3",
          "acs:script:*:owner:script/actor/script-2",
          "acs:script:*:owner:script/actor/script-1",
        ],
      }),
    );
  });
  it("does not hydrate any body when no resource is allowed", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }) => resources.map(() => deny));
    await expect(service.list("actor", request())).resolves.toEqual([]);
    expect(repository.readTargets).toHaveBeenCalledWith("actor", "owner", []);
  });
  it("rejects missing principals and caller identity substitution", async () => {
    await expect(service.list("actor")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.list("other", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.scanTargets).not.toHaveBeenCalled();
  });
  it("fails closed on incomplete decisions before hydration", async () => {
    iam.authorizeMany.mockResolvedValue([allow]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.readTargets).not.toHaveBeenCalled();
  });
  it("rejects scope-escaping metadata and a nonprogressing cursor", async () => {
    repository.scanTargets.mockResolvedValue([{ ...target("script-3"), userId: "other" }]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
    repository.scanTargets.mockResolvedValue([target("script-2"), target("script-3")]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects changed snapshots and records not selected by IAM", async () => {
    repository.readTargets.mockResolvedValue([
      { ...target("script-2"), status: 1, name: "fixture", content: "private", description: null },
    ]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks revocation before hydration and again before returning earlier chunks", async () => {
    iam.authorizeMany.mockResolvedValueOnce([allow, deny, allow]).mockResolvedValueOnce([deny, deny]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.readTargets).not.toHaveBeenCalled();
    iam.authorizeMany.mockReset();
    iam.authorizeMany
      .mockResolvedValueOnce([allow, deny, allow])
      .mockResolvedValueOnce([allow, allow])
      .mockResolvedValueOnce([deny, deny]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("resolves exact owned targets using trusted account metadata and rejects case aliases", async () => {
    const principal = service.identity("actor", request()).principal;
    await expect(userScriptResourceResolver({ request: request(), principal })).resolves.toBe(
      "acs:script:*:owner:script/actor/script-2",
    );
    repository.findTarget.mockResolvedValue(target("SCRIPT-2"));
    await expect(userScriptResourceResolver({ request: request(), principal })).resolves.toBeUndefined();
  });
  it("does not authorize creation or mutation on Deny or missing target", async () => {
    iam.authorizeMany.mockResolvedValue([deny]);
    await expect(service.authorizeCreate("actor", request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.authorizeTarget("script-2", "actor", "quyan:script:DeleteScript", request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    repository.findTarget.mockResolvedValue(null);
    await expect(
      service.authorizeTarget("script-2", "actor", "quyan:script:DeleteScript", request()),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
