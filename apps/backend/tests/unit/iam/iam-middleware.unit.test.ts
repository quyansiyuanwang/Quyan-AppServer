import { beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import type { IamConditionContext } from "@quyan/shared";
import { evaluatePolicies } from "../../../src/iam/evaluator/policy-evaluator";
import type { IamPolicyInput } from "../../../src/iam/evaluator/policy-evaluator";
import { mockDeep } from "vitest-mock-extended";
import type { IamAuthorizationService } from "../../../src/iam/iam-authorization.service";
const mocks = vi.hoisted(() => ({
  mode: "legacy" as "legacy" | "shadow" | "enforce",
  authorize: vi.fn(),
  loadPolicies: vi.fn(),
  legacy: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("../../../src/config/env", () => ({
  env: {
    security: {
      get iamAuthorizationMode() {
        return mocks.mode;
      },
    },
  },
}));
vi.mock("../../../src/iam/iam-authorization.service", () => ({
  IamAuthorizationService: {
    getInstance: () => ({
      authorize: mocks.authorize,
      loadPolicies: mocks.loadPolicies,
      // The bridge test double retains real policy evaluation; trusted resource providers have dedicated coverage.
      evaluateLoadedPolicies: async (input: {
        action: string;
        resources: string[];
        policies: IamPolicyInput[];
        context?: IamConditionContext;
      }) =>
        input.resources.map((resource) =>
          evaluatePolicies(input.policies, { action: input.action, resource, context: input.context }),
        ),
    }),
  },
}));
vi.mock("../../../src/services/users/permission.service", () => ({
  PermissionService: { getInstance: () => ({ checkUserPermissions: mocks.legacy }) },
}));
vi.mock("../../../src/iam/audit/iam-audit.service", () => ({ auditIamDecision: mocks.audit }));
vi.mock("../../../src/util/logger", () => ({
  LogCategory: { SECURITY: "security" },
  getLogger: () => ({ warn: vi.fn() }),
}));
import {
  iamAuthorizationMiddleware,
  iamAuthenticatedAuthorizationMiddleware,
  iamCollectionAuthorizationMiddleware,
} from "../../../src/iam/middleware/iam-authorization.middleware";
import {
  authorizeLegacyPermissions,
  validateLegacyIamDefinitions,
} from "../../../src/iam/middleware/legacy-permission-bridge";
import { parseIamPolicy } from "../../../src/iam/parser/policy-parser";
import { ramAccountResourceResolver } from "../../../src/iam/request/resource-resolvers";
const request = () =>
  ({
    user: { userId: "child" },
    authContext: { principalUserId: "child", accountOwnerId: "owner", subjectType: "access_key" },
    headers: { "x-action": "quyan:ram:DeleteUser" },
  }) as never;
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] } as const;
const deny = { decision: "ImplicitDeny", reason: "no-matching-allow", matchedStatements: [] } as const;
describe("IAM middleware and rollout bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mode = "legacy";
    mocks.authorize.mockResolvedValue(allow);
    mocks.legacy.mockResolvedValue({
      hasPermission: true,
      checkedPermissions: [Permission.RAM_USER_CREATE],
      missingPermissions: [],
    });
    mocks.loadPolicies.mockResolvedValue([]);
  });
  it("keeps authenticated-only legacy enforcement while shadow records and enforce blocks Deny", async () => {
    for (const mode of ["legacy", "shadow", "enforce"] as const) {
      vi.clearAllMocks();
      mocks.mode = mode;
      const service = mockDeep<IamAuthorizationService>(),
        next = vi.fn();
      service.authorize.mockResolvedValue({ ...deny, matchedStatements: [] });
      await iamAuthenticatedAuthorizationMiddleware(
        {
          action: "quyan:permission:Manage",
          resourceKind: "single-resource",
          resource: () => "acs:quyan:*:owner:user/child",
        },
        service,
      )(request(), {} as never, next);
      if (mode === "enforce") expect(next.mock.calls[0][0].statusCode).toBe(403);
      else expect(next).toHaveBeenCalledExactlyOnceWith();
      if (mode === "legacy") expect(service.authorize).not.toHaveBeenCalled();
      else expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ authorizationMode: mode }));
    }
  });
  it("never falls back to authenticated access in enforce after provider failure", async () => {
    const service = mockDeep<IamAuthorizationService>();
    service.authorize.mockRejectedValue(new Error("provider-unavailable"));
    for (const mode of ["shadow", "enforce"] as const) {
      mocks.mode = mode;
      const next = vi.fn();
      await iamAuthenticatedAuthorizationMiddleware(
        {
          action: "quyan:permission:Manage",
          resourceKind: "single-resource",
          resource: () => "acs:quyan:*:owner:user/child",
        },
        service,
      )(request(), {} as never, next);
      if (mode === "shadow") expect(next).toHaveBeenCalledExactlyOnceWith();
      else expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    }
  });
  it("validates collection identity and policies without inventing a blanket row Allow", async () => {
    mocks.mode = "enforce";
    const service = mockDeep<IamAuthorizationService>(),
      next = vi.fn();
    service.loadPolicies.mockResolvedValue([]);
    await iamCollectionAuthorizationMiddleware(
      {
        action: "quyan:developer:ListProjects",
        resourceKind: "collection",
        resource: () => "acs:quyan:*:owner:user/child",
      },
      service,
    )(request(), {} as never, next);
    expect(next).toHaveBeenCalledExactlyOnceWith();
    expect(service.loadPolicies).toHaveBeenCalledTimes(1);
    expect(service.authorize).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("rejects invalid collection boundaries and provider failures in enforce", async () => {
    mocks.mode = "enforce";
    for (const boundary of [undefined, "*", "acs:quyan:*:foreign:user/child", "acs:unknown:*:owner:item/x"]) {
      const service = mockDeep<IamAuthorizationService>(),
        next = vi.fn();
      await iamCollectionAuthorizationMiddleware(
        { action: "quyan:developer:ListProjects", resourceKind: "collection", resource: () => boundary },
        service,
      )(request(), {} as never, next);
      expect(next.mock.calls[0][0].statusCode).toBe(403);
      expect(service.loadPolicies).not.toHaveBeenCalled();
    }
    const service = mockDeep<IamAuthorizationService>(),
      next = vi.fn();
    service.loadPolicies.mockRejectedValue(new Error("provider-unavailable"));
    await iamCollectionAuthorizationMiddleware(
      {
        action: "quyan:developer:ListProjects",
        resourceKind: "collection",
        resource: () => "acs:quyan:*:owner:user/child",
      },
      service,
    )(request(), {} as never, next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
  });
  it("uses only server action metadata, records decision and invokes next once", async () => {
    const service = mockDeep<IamAuthorizationService>();
    service.authorize.mockResolvedValue({ ...allow, matchedStatements: [] });
    const req = request(),
      next = vi.fn();
    const middleware = iamAuthorizationMiddleware(
      { action: "quyan:ram:CreateUser", resourceKind: "account", resource: ramAccountResourceResolver },
      service,
    );
    await middleware(req, {} as never, next);
    expect(next).toHaveBeenCalledExactlyOnceWith();
    expect(service.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:ram:CreateUser", resource: "acs:quyan:*:owner:account" }),
    );
    expect((req as { iamDecisions?: unknown[] }).iamDecisions).toHaveLength(1);
  });
  it("returns 401 without an authenticated principal and 403 on unresolved resources", async () => {
    const service = mockDeep<IamAuthorizationService>(),
      next = vi.fn();
    const middleware = iamAuthorizationMiddleware(
      { action: "quyan:ram:CreateUser", resourceKind: "single-resource", resource: () => undefined },
      service,
    );
    await middleware({} as never, {} as never, next);
    expect(next.mock.calls[0][0].statusCode).toBe(401);
    next.mockClear();
    await middleware(request(), {} as never, next);
    expect(next.mock.calls[0][0].statusCode).toBe(403);
    expect(service.authorize).not.toHaveBeenCalled();
  });
  it("rejects both implicit and explicit Deny without returning policy details", async () => {
    for (const decision of ["ImplicitDeny", "ExplicitDeny"] as const) {
      const service = mockDeep<IamAuthorizationService>(),
        next = vi.fn();
      service.authorize.mockResolvedValue({
        ...deny,
        decision,
        matchedStatements: [{ policyId: "sensitive-policy", statementId: "secret-rule", effect: "Deny" }],
      });
      await iamAuthorizationMiddleware(
        { action: "quyan:ram:CreateUser", resourceKind: "account", resource: ramAccountResourceResolver },
        service,
      )(request(), {} as never, next);
      expect(next.mock.calls[0][0].statusCode).toBe(403);
      expect(next.mock.calls[0][0].message).not.toContain("sensitive-policy");
    }
  });
  it("authorizes every resource in one batch and blocks the entire mutation on any Deny", async () => {
    for (const last of [allow, deny, { ...deny, decision: "ExplicitDeny", reason: "explicit-deny" } as const]) {
      const service = mockDeep<IamAuthorizationService>();
      service.authorizeMany.mockResolvedValue([
        { ...allow, matchedStatements: [] },
        { ...last, matchedStatements: [] },
      ]);
      const req = request(),
        mutation = vi.fn(),
        errors = vi.fn();
      const resources = ["acs:quyan:*:owner:user/one", "acs:quyan:*:owner:user/two"];
      await iamAuthorizationMiddleware(
        { action: "quyan:ram:UpdateUser", resourceKind: "batch", resource: () => resources },
        service,
      )(req, {} as never, (error) => (error ? errors(error) : mutation()));
      expect(service.authorizeMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ resources }));
      expect(service.authorize).not.toHaveBeenCalled();
      expect((req as { iamDecisions?: unknown[] }).iamDecisions).toHaveLength(2);
      if (last.decision === "Allow") expect(mutation).toHaveBeenCalledOnce();
      else {
        expect(mutation).not.toHaveBeenCalled();
        expect(errors.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
      }
      expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ batchSize: 2, batchIndex: 1 }));
    }
  });
  it.each([
    undefined,
    [],
    ["acs:quyan:*:owner:user/one", undefined],
    ["not-an-arn"],
    new Array(2),
    new Array(501).fill("*"),
  ])("rejects unresolved, malformed, sparse and excessive batches before policy evaluation %#", async (resources) => {
    const service = mockDeep<IamAuthorizationService>(),
      next = vi.fn();
    await iamAuthorizationMiddleware(
      { action: "quyan:ram:UpdateUser", resourceKind: "batch", resource: () => resources as never },
      service,
    )(request(), {} as never, next);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
    expect(service.authorizeMany).not.toHaveBeenCalled();
  });
  it("fails closed if evaluation is incomplete or policy loading throws", async () => {
    const service = mockDeep<IamAuthorizationService>();
    const middleware = iamAuthorizationMiddleware(
      {
        action: "quyan:ram:UpdateUser",
        resourceKind: "batch",
        resource: () => ["acs:quyan:*:owner:user/one", "acs:quyan:*:owner:user/two"],
      },
      service,
    );
    const next = vi.fn();
    service.authorizeMany.mockResolvedValue([{ ...allow, matchedStatements: [] }]);
    await middleware(request(), {} as never, next);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
    next.mockClear();
    service.authorizeMany.mockRejectedValue(new Error("Policy storage unavailable"));
    await middleware(request(), {} as never, next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it("does not call legacy as fallback when policy loading fails in enforce mode", async () => {
    mocks.mode = "enforce";
    mocks.loadPolicies.mockRejectedValue(Error("offline"));
    await expect(authorizeLegacyPermissions(request(), [Permission.RAM_USER_CREATE], false)).rejects.toThrow("offline");
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it("preserves legacy decisions in legacy and shadow modes, including shadow engine failure", async () => {
    expect(await authorizeLegacyPermissions(request(), [Permission.RAM_USER_CREATE], false)).toBe(true);
    expect(mocks.loadPolicies).not.toHaveBeenCalled();
    mocks.mode = "shadow";
    expect(await authorizeLegacyPermissions(request(), [Permission.RAM_USER_CREATE], false)).toBe(true);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationMode: "shadow",
        legacyAllowed: true,
        result: expect.objectContaining({ decision: "ImplicitDeny" }),
      }),
    );
    mocks.loadPolicies.mockRejectedValue(Error("offline"));
    expect(await authorizeLegacyPermissions(request(), [Permission.RAM_USER_CREATE], false)).toBe(true);
  });
  it("uses declared resources in enforce mode instead of repeating account-level checks", async () => {
    mocks.mode = "enforce";
    mocks.loadPolicies.mockResolvedValue([
      {
        policyId: "scoped",
        document: parseIamPolicy({
          Version: "1",
          Statement: {
            Effect: "Allow",
            Action: "quyan:ram:UpdateUser",
            Resource: "acs:quyan:*:owner:user/target",
          },
        }).document,
      },
    ]);
    const req = request();
    expect(
      await authorizeLegacyPermissions(req, [Permission.RAM_USER_UPDATE], false, {
        action: "quyan:ram:UpdateUser",
        resourceKind: "single-resource",
        resource: () => "acs:quyan:*:owner:user/target",
      }),
    ).toBe(true);
    expect((req as { iamDecisions?: { resource: string }[] }).iamDecisions?.[0].resource).toBe(
      "acs:quyan:*:owner:user/target",
    );
    expect(await authorizeLegacyPermissions(request(), [Permission.RAM_USER_UPDATE], false)).toBe(false);
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it("preserves rollback modes for declared resources, including resolver failure in shadow", async () => {
    const resource = vi.fn(() => undefined);
    const definition = { action: "quyan:ram:CreateUser", resourceKind: "single-resource" as const, resource };
    expect(await authorizeLegacyPermissions(request(), [Permission.RAM_USER_CREATE], false, definition)).toBe(true);
    expect(resource).not.toHaveBeenCalled();
    mocks.mode = "shadow";
    expect(await authorizeLegacyPermissions(request(), [Permission.RAM_USER_CREATE], false, definition)).toBe(true);
    expect(resource).toHaveBeenCalledOnce();
    mocks.mode = "enforce";
    await expect(
      authorizeLegacyPermissions(request(), [Permission.RAM_USER_CREATE], false, definition),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("checks the whole batch in the rollout bridge and keeps multi-permission ANY semantics", async () => {
    mocks.mode = "enforce";
    mocks.loadPolicies.mockResolvedValue([
      {
        policyId: "scoped",
        document: parseIamPolicy({
          Version: "1",
          Statement: [
            { Effect: "Allow", Action: "quyan:ram:CreateUser", Resource: "*" },
            { Effect: "Deny", Action: "quyan:ram:CreateUser", Resource: "acs:quyan:*:owner:user/blocked" },
          ],
        }).document,
      },
    ]);
    expect(
      await authorizeLegacyPermissions(request(), [Permission.RAM_USER_CREATE], false, {
        action: "quyan:ram:CreateUser",
        resourceKind: "batch",
        resource: () => ["acs:quyan:*:owner:user/ok", "acs:quyan:*:owner:user/blocked"],
      }),
    ).toBe(false);
    const definitions = [
      { action: "quyan:ram:CreateUser", resourceKind: "account" as const, resource: ramAccountResourceResolver },
      { action: "quyan:ram:ReadUser", resourceKind: "account" as const, resource: ramAccountResourceResolver },
    ];
    expect(
      await authorizeLegacyPermissions(
        request(),
        [Permission.RAM_USER_CREATE, Permission.RAM_USER_READ],
        true,
        definitions,
      ),
    ).toBe(true);
    expect(
      await authorizeLegacyPermissions(
        request(),
        [Permission.RAM_USER_CREATE, Permission.RAM_USER_READ],
        false,
        definitions,
      ),
    ).toBe(false);
  });
  it("rejects mismatched actions and incomplete permission metadata at definition time", () => {
    const definition = {
      action: "quyan:ram:CreateUser",
      resourceKind: "account" as const,
      resource: ramAccountResourceResolver,
    };
    expect(() => validateLegacyIamDefinitions([Permission.RAM_USER_UPDATE], definition)).toThrow();
    expect(() =>
      validateLegacyIamDefinitions([Permission.RAM_USER_CREATE, Permission.RAM_USER_READ], definition),
    ).toThrow();
    expect(() => validateLegacyIamDefinitions([Permission.RAM_USER_CREATE], [])).toThrow();
  });
  it("enforces ALL and ANY semantics through IAM policies", async () => {
    mocks.mode = "enforce";
    mocks.loadPolicies.mockResolvedValue([
      {
        policyId: "allow",
        document: parseIamPolicy({
          Version: "1",
          Statement: { Effect: "Allow", Action: "quyan:ram:CreateUser", Resource: "*" },
        }).document,
      },
    ]);
    expect(
      await authorizeLegacyPermissions(request(), [Permission.RAM_USER_CREATE, Permission.RAM_USER_READ], true),
    ).toBe(true);
    expect(
      await authorizeLegacyPermissions(request(), [Permission.RAM_USER_CREATE, Permission.RAM_USER_READ], false),
    ).toBe(false);
  });
  it("refuses absent or invalid resolver metadata at startup", () => {
    expect(() =>
      iamAuthorizationMiddleware({
        action: "quyan:ram:CreateUser",
        resourceKind: "unknown",
        resource: ramAccountResourceResolver,
      } as never),
    ).toThrow();
    expect(() =>
      iamAuthorizationMiddleware({
        action: "quyan:ram:CreateUser",
        resourceKind: "account",
        resource: undefined,
      } as never),
    ).toThrow();
  });
  it("refuses unknown endpoint actions at startup", () => {
    expect(() =>
      iamAuthorizationMiddleware({
        action: "unknown:Action",
        resourceKind: "account",
        resource: ramAccountResourceResolver,
      }),
    ).toThrow();
  });
});
