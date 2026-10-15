import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: () => ({}) } }));
vi.mock("@/store/relay/relay-provider-earnings-claim.repository", () => ({
  RelayProviderEarningsClaimRepository: { getInstance: () => ({}) },
}));
vi.mock("@/store/users/iam-account-principal", () => ({
  IamAccountUserRepository: { getInstance: () => ({}) },
  iamAccountDenied: () => Object.assign(new Error("fixture denied"), { statusCode: 403 }),
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: () => ({}) } }));
vi.mock("@/util/logger", () => ({ getLogger: () => ({ warn: vi.fn() }), LogCategory: { SECURITY: "security" } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { env } from "@/config/env";
import { RelayProviderEarningsClaimIamService } from "@/services/relay/relay-provider-earnings-claim-iam.service";
import type { ProviderEarningsClaimGuard } from "@/store/relay/relay-provider-earnings-claim.repository";
import { relayProviderArn } from "@/iam/resources/relay-provider-resources";
import { relayProviderClaimBalanceResourceResolver } from "@/iam/request/relay-provider-resource-resolvers";
import { getIamActionDefinition, isIamActionResourceCompatible, Permission } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  repository = { claim: vi.fn() },
  users = { targets: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  legacy = vi.fn(),
  service = new RelayProviderEarningsClaimIamService(iam, repository, users, permissions);
const req = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "fake:action" },
    secure: true,
  }) as unknown as TypedRequest;
const claim = () => service.claim("actor", req(), legacy);
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  users.targets.mockResolvedValue(["owner", "actor"].map((id) => ({ id, updateTime: new Date(0) })));
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
  repository.claim.mockImplementation(async (guard: ProviderEarningsClaimGuard, dryRun) => {
    await guard.authorize([relayProviderArn("owner", "actor", "provider")]);
    if (!dryRun) {
      await guard.checkGenerated("settlement", "settlement");
      await guard.checkGenerated("transaction", "ledger");
    }
    await guard.users.recheck();
    return { settledAmount: 5, settlementId: "settlement" };
  });
  legacy.mockResolvedValue({ settledAmount: 12, settlementId: "legacy" });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("provider earnings claim authorization", () => {
  it("declares a fixed action for the exact balance boundary and all generated resources", async () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "POST /v1/relay-channels/provider/earnings/claim",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:ClaimMyProviderEarnings"], issues: [] });
    expect(getIamActionDefinition("quyan:relay:ClaimMyProviderEarnings")).toMatchObject({
      legacyPermission: Permission.RELAY_CHANNEL_PROVIDER_SETTLE,
      resourceTypes: expect.arrayContaining(["balance/account", "balance/transaction", "relay/provider-settlement"]),
    });
    const principal = {
      subjectUserId: "actor",
      principalUserId: "actor",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    };
    const resource = await relayProviderClaimBalanceResourceResolver({
      principal,
      request: { ...req(), body: { userId: "foreign", accountOwnerId: "foreign" } } as unknown as TypedRequest<unknown>,
    });
    expect(resource).toBe("acs:balance:*:owner:account/actor");
    expect(isIamActionResourceCompatible("quyan:relay:ClaimMyProviderEarnings", resource!)).toBe(true);
  });
  it("projects the legacy grant to a user-scoped balance account and generated children", () => {
    const document = legacyPermissionsToPrincipalPolicy([Permission.RELAY_CHANNEL_PROVIDER_SETTLE], "owner", "actor")!;
    for (const resource of [
      "acs:balance:*:owner:account/actor",
      "acs:relay:*:owner:provider/actor/provider",
      "acs:relay:*:owner:provider-earning/actor/earning",
      "acs:relay:*:owner:provider-settlement/actor/settlement",
      "acs:balance:*:owner:transaction/actor/ledger",
    ]) {
      expect(
        evaluatePolicies([{ policyId: "fixture", document }], {
          action: "quyan:relay:ClaimMyProviderEarnings",
          resource,
        }).decision,
      ).toBe("Allow");
    }
  });
  it("uses server action and rechecks generated settlement and ledger ARNs", async () => {
    expect(await claim()).toMatchObject({ settledAmount: 5 });
    const calls = iam.authorizeMany.mock.calls.map(([input]) => input);
    expect(calls.every((input) => input.action === "quyan:relay:ClaimMyProviderEarnings")).toBe(true);
    expect(calls.flatMap((input) => input.resources)).toEqual(
      expect.arrayContaining([
        "acs:relay:*:owner:provider-settlement/actor/settlement",
        "acs:balance:*:owner:transaction/actor/ledger",
      ]),
    );
    expect(repository.claim).toHaveBeenCalledWith(expect.anything(), false);
    expect(legacy).not.toHaveBeenCalled();
  });
  it("rejects denied or missing evaluator results without legacy fallback", async () => {
    iam.authorizeMany.mockResolvedValue([{ decision: "ExplicitDeny", reason: "fixture", matchedStatements: [] }]);
    await expect(claim()).rejects.toMatchObject({ statusCode: 403 });
    iam.authorizeMany.mockResolvedValue([]);
    await expect(claim()).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).not.toHaveBeenCalled();
  });
  it("rejects missing or mismatched identities", async () => {
    await expect(service.claim("actor", undefined, legacy)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.claim("someone", req(), legacy)).rejects.toMatchObject({ statusCode: 403 });
    const oauth = req();
    oauth.oauthAccessToken = {} as NonNullable<TypedRequest["oauthAccessToken"]>;
    await expect(service.claim("actor", oauth, legacy)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.claim).not.toHaveBeenCalled();
  });
  it("rejects identity changes", async () => {
    users.targets
      .mockResolvedValueOnce(["owner", "actor"].map((id) => ({ id, updateTime: new Date(0) })))
      .mockResolvedValue([]);
    await expect(claim()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects reused generated identifiers", async () => {
    repository.claim.mockImplementation(async (guard: ProviderEarningsClaimGuard) => {
      await guard.checkGenerated("transaction", "duplicate");
      await guard.checkGenerated("transaction", "duplicate");
    });
    await expect(claim()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects policy changes before commit", async () => {
    iam.loadPolicies.mockResolvedValueOnce([]).mockResolvedValue([
      {
        policyId: "changed",
        document: {
          Version: "1",
          Statement: { Effect: "Deny", Action: "quyan:relay:ClaimMyProviderEarnings", Resource: "*" },
        },
      },
    ]);
    await expect(claim()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses a read-only native preview in shadow and retains the legacy result", async () => {
    env.security.iamAuthorizationMode = "shadow";
    expect(await claim()).toMatchObject({ settledAmount: 12 });
    expect(repository.claim).toHaveBeenCalledWith(expect.anything(), true);
    repository.claim.mockRejectedValue(new Error("fixture unavailable"));
    expect(await claim()).toMatchObject({ settledAmount: 12 });
  });
  it("retains legacy qualification and bypasses the native transaction in legacy", async () => {
    env.security.iamAuthorizationMode = "legacy";
    expect(await claim()).toMatchObject({ settledAmount: 12 });
    expect(repository.claim).not.toHaveBeenCalled();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(claim()).rejects.toMatchObject({ statusCode: 403 });
  });
});
