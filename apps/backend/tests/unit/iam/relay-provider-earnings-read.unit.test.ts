import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: () => ({}) } }));
vi.mock("@/store/relay/relay-provider-earnings-read.repository", () => ({
  RelayProviderEarningsReadRepository: { getInstance: () => ({}) },
}));
vi.mock("@/store/users/iam-account-principal", () => ({
  IamAccountUserRepository: { getInstance: () => ({}) },
  iamAccountDenied: () => Object.assign(new Error("fixture denied"), { statusCode: 403 }),
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: () => ({}) } }));
vi.mock("@/util/logger", () => ({ getLogger: () => ({ warn: vi.fn() }), LogCategory: { SECURITY: "security" } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { RelayProviderEarningsReadIamService } from "@/services/relay/relay-provider-earnings-read-iam.service";
import { relayProviderArn, relayProviderEarningArn } from "@/iam/resources/relay-provider-resources";
import { getIamActionDefinition, isIamActionResourceCompatible, Permission } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  repository = { list: vi.fn() },
  users = { targets: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  legacy = vi.fn(),
  service = new RelayProviderEarningsReadIamService(iam, repository, users, permissions);
const req = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "forged:action" },
    secure: true,
  }) as unknown as TypedRequest;
const list = (request: TypedRequest | undefined = req()) =>
  service.list("actor", request, { page: 1, pageSize: 20 }, legacy);
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  users.targets.mockResolvedValue(["owner", "actor"].map((id) => ({ id, updateTime: new Date(0) })));
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
  repository.list.mockImplementation(async (_p, _page, decide, recheck) => {
    await decide([
      relayProviderArn("owner", "actor", "provider"),
      relayProviderEarningArn("owner", "actor", "earning"),
    ]);
    await recheck();
    return { total: 0, records: [], pendingAmount: 0, settledAmount: 0 };
  });
  legacy.mockResolvedValue({ total: 9, page: 1, pageSize: 20, records: [], pendingAmount: 17, settledAmount: 5 });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("personal provider earnings IAM", () => {
  it("registers a fixed collection action and both resource types", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "GET /v1/relay-channels/provider/earnings",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:ListMyProviderEarnings"], issues: [] });
    expect(getIamActionDefinition("quyan:relay:ListMyProviderEarnings")).toMatchObject({
      legacyPermission: Permission.RELAY_CHANNEL_PROVIDER_READ,
      resourceTypes: ["relay/provider", "relay/provider-earning"],
    });
    expect(
      isIamActionResourceCompatible(
        "quyan:relay:ListMyProviderEarnings",
        relayProviderEarningArn("owner", "actor", "earning"),
      ),
    ).toBe(true);
    expect(
      isIamActionResourceCompatible("quyan:relay:ListMyProviderEarnings", "acs:relay:*:owner:channel/channel"),
    ).toBe(false);
  });
  it("uses trusted user/account and server action despite a forged action header", async () => {
    expect(await list()).toMatchObject({ total: 0, pendingAmount: 0, settledAmount: 0 });
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:relay:ListMyProviderEarnings",
        resources: ["acs:relay:*:owner:provider/actor/provider", "acs:relay:*:owner:provider-earning/actor/earning"],
      }),
    );
    expect(permissions.checkUserPermissions).not.toHaveBeenCalled();
  });
  it("denies missing, foreign, delegated and OAuth identities", async () => {
    await expect(service.list("actor", undefined, { page: 1, pageSize: 20 }, legacy)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.list("someone", req(), { page: 1, pageSize: 20 }, legacy)).rejects.toMatchObject({
      statusCode: 403,
    });
    const delegated = req();
    delegated.authContext!.principalUserId = "issuer";
    await expect(list(delegated)).rejects.toMatchObject({ statusCode: 403 });
    const oauth = req();
    oauth.oauthAccessToken = {} as NonNullable<TypedRequest["oauthAccessToken"]>;
    await expect(list(oauth)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.list).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each([
    { page: NaN, pageSize: 20 },
    { page: 1, pageSize: 101 },
    { page: Number.MAX_SAFE_INTEGER, pageSize: 20 },
  ])("denies unsafe pagination %j", async (pagination) => {
    await expect(service.list("actor", req(), pagination, legacy)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails closed on truncated evaluator results", async () => {
    iam.authorizeMany.mockResolvedValue([]);
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).not.toHaveBeenCalled();
  });
  it("rejects changed policy fingerprints", async () => {
    iam.loadPolicies
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        {
          policyId: "changed",
          document: {
            Version: "1",
            Statement: { Effect: "Deny", Action: "quyan:relay:ListMyProviderEarnings", Resource: "*" },
          },
        },
      ]);
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects identity revocation during the response recheck", async () => {
    users.targets
      .mockResolvedValueOnce(["owner", "actor"].map((id) => ({ id, updateTime: new Date(0) })))
      .mockResolvedValue([]);
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("preserves legacy response and permissions in %s", async (selected) => {
    env.security.iamAuthorizationMode = selected;
    repository.list.mockRejectedValue(new Error("fixture unavailable"));
    expect(await list()).toMatchObject({ total: 9, pendingAmount: 17 });
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects unsafe provider identifiers", () => {
    expect(() => relayProviderArn("owner", "actor", "bad/id")).toThrow();
    expect(() => relayProviderEarningArn("owner", "actor*", "earning")).toThrow();
  });
});
