import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/users/iam-account-principal", () => ({
  IamAccountUserRepository: { getInstance: vi.fn() },
  iamAccountDenied: () => Object.assign(new Error("fixture denied"), { statusCode: 403 }),
}));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { TerminalPersonalDeviceReadIamService } from "@/services/remote-terminal/terminal-personal-device-read-iam.service";
import { getIamActionDefinition } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const iam = { authorizeMany: vi.fn(), loadPolicies: vi.fn() },
  repository = { list: vi.fn() },
  users = { targets: vi.fn() },
  legacy = vi.fn();
const service = new TerminalPersonalDeviceReadIamService(iam, repository, users),
  mode = env.security.iamAuthorizationMode;
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "client:Fake" },
    secure: true,
    ip: "192.0.2.42",
  }) as unknown as TypedRequest;
const read = () =>
  service.list("actor", request(), { page: 1, pageSize: 10 }, undefined, (view) => view.record.id, legacy);
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "matched-allow", matchedStatements: [] })),
  );
  iam.loadPolicies.mockResolvedValue([]);
  users.targets.mockResolvedValue(["actor", "owner"].map((id) => ({ id, updateTime: new Date(0) })));
  repository.list.mockImplementation(async (_principal, _pagination, _status, decide, recheck) => {
    await recheck();
    await decide(["acs:remote-terminal:*:owner:product-binding/actor/binding"]);
    return { total: 1, records: [{ record: { id: "binding", userId: "actor" } }] };
  });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("personal terminal device collection", () => {
  it("declares resource filtering instead of a blanket user-resource admission", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/remote-terminal/remote-terminal-product.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (r) => r.key === "GET /v1/remote-terminal/products/me/devices",
      ),
    ).toMatchObject({
      coverage: "explicit",
      resourceKind: "collection",
      actions: ["quyan:remote_terminal:ListMyDevices"],
      issues: [],
    });
    expect(getIamActionDefinition("quyan:remote_terminal:ListMyDevices")).toMatchObject({
      defaultAuthorizationScope: "self",
    });
  });
  it("fixes the endpoint action and trusted identity in the shared decision protocol", async () => {
    expect(await read()).toMatchObject({ records: ["binding"] });
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:remote_terminal:ListMyDevices",
        principal: expect.objectContaining({ accountOwnerId: "owner" }),
      }),
    );
    expect(legacy).not.toHaveBeenCalled();
  });
  it("rejects foreign records and malformed decisions", async () => {
    repository.list.mockResolvedValue({ total: 1, records: [{ record: { id: "binding", userId: "peer" } }] });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    repository.list.mockImplementation(async (_p, _page, _s, decide) => {
      await decide(["acs:remote-terminal:*:owner:product-binding/actor/binding"]);
      return { total: 0, records: [] };
    });
    iam.authorizeMany.mockResolvedValue([null]);
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
});
