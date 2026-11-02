import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { RelayProbeAccountEditorIamService } from "@/services/relay/relay-probe-account-editor-iam.service";
import type { TypedRequest } from "@/types/express";
const original = env.security.iamAuthorizationMode;
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() };
const repository = { read: vi.fn() };
const identities = { snapshot: vi.fn(), recheck: vi.fn() };
const permissions = { checkUserPermissions: vi.fn() };
const project = vi.fn(),
  legacy = vi.fn();
const service = new RelayProbeAccountEditorIamService(iam, repository, identities, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: {},
    secure: true,
  }) as unknown as TypedRequest;
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
  identities.snapshot.mockResolvedValue({ group: { id: "fixture" }, users: [] });
  repository.read.mockImplementation(async (_id, _principal, _snapshot, recheck, callback) => {
    await recheck();
    const result = callback({ id: "fixture" });
    await recheck();
    return result;
  });
  project.mockReturnValue({ safe: true });
});
afterEach(() => {
  env.security.iamAuthorizationMode = original;
});
describe("safe account editor authorization", () => {
  it("requires UpdateProbeAccount before projecting saved configuration", async () => {
    expect(await service.read("fixture", request(), project, legacy)).toEqual({ safe: true });
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:relay:UpdateProbeAccount" }),
    );
    expect(legacy).not.toHaveBeenCalled();
  });
  it("does not decrypt configuration for denied resources", async () => {
    iam.authorizeMany.mockResolvedValue([{ decision: "ImplicitDeny" }]);
    await expect(service.read("fixture", request(), project, legacy)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.read).not.toHaveBeenCalled();
    expect(project).not.toHaveBeenCalled();
  });
  it("rejects a revoked grant before returning the projected result", async () => {
    project.mockImplementationOnce(() => {
      iam.authorizeMany.mockResolvedValue([{ decision: "ExplicitDeny" }]);
      return { safe: true };
    });
    await expect(service.read("fixture", request(), project, legacy)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects missing, delegated, and OAuth contexts", async () => {
    const delegated = request();
    delegated.authContext!.principalUserId = "different";
    const oauth = request();
    oauth.oauthAccessToken = {} as TypedRequest["oauthAccessToken"];
    for (const req of [undefined, delegated, oauth])
      await expect(service.read("fixture", req, project, legacy)).rejects.toMatchObject({ statusCode: 403 });
    expect(project).not.toHaveBeenCalled();
  });
});
