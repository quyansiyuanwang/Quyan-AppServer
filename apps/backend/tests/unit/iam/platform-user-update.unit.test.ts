vi.mock("@/util/logger", () => ({
  getLogger: () => ({ warn: vi.fn(), error: vi.fn() }),
  LogCategory: { SECURITY: "security" },
}));
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
import { PlatformUserUpdateIamService } from "@/services/users/platform-user-update-iam.service";
import { platformUserArn, platformUserGroupArn } from "@/iam/resources/platform-user-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { TypedRequest } from "@/types/express";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const iam = {
    loadPolicies: vi.fn(),
    authorizeMany: vi.fn(),
    loadGroupPolicies: vi.fn(),
    loadDelegatablePolicies: vi.fn(),
  },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = {
    target: vi.fn(),
    destination: vi.fn(),
    authorizationRevision: vi.fn(),
    recheck: vi.fn(),
    update: vi.fn(),
  },
  service = new PlatformUserUpdateIamService(iam, snapshots, repository);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*", "x-account-id": "forged" },
    secure: true,
    ip: "192.0.2.20",
  }) as unknown as TypedRequest;
const group = (id = "old") => ({ id, accountOwnerId: "owner", level: 10, updateTime: new Date(0) });
const target = () => ({
  resource: { id: "target", status: 0, revision: "a".repeat(64), updateTime: new Date(0), createTime: new Date(0) },
  group: group(),
  accountOwnerId: "owner",
  actorLevel: 5,
  email: "old@example.test",
  recoveryBootstrap: false,
});
const policy = (Effect = "Allow", Resource = "acs:quyan:*:owner:user/*") =>
  parseIamPolicy({ Version: "1", Statement: { Effect, Action: "quyan:ram:UpdateUser", Resource } }).document;
beforeEach(() => {
  vi.resetAllMocks();
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "matched-allow", matchedStatements: [] })),
  );
  iam.loadGroupPolicies.mockResolvedValue([]);
  iam.loadDelegatablePolicies.mockResolvedValue([]);
  snapshots.snapshot.mockResolvedValue({
    group: { id: "global", updateTime: new Date(0) },
    users: [
      { id: "actor", updateTime: new Date(0) },
      { id: "owner", updateTime: new Date(0) },
    ],
  });
  repository.target.mockResolvedValue(target());
  repository.destination.mockImplementation(async (_p, _t, id) => group(id));
  repository.authorizationRevision.mockResolvedValue("b".repeat(64));
  repository.update.mockResolvedValue({ user: { id: "target", name: "new", status: 0 }, previousStatus: 0 });
});
describe("platform user update authorization", () => {
  it("uses the fixed action and real target resource, ignoring forged request metadata", async () => {
    await service.execute("target", { name: "new" }, "actor", request());
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:user:UpdateUser", resources: [platformUserArn("target")] }),
    );
    expect(repository.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: "new" }, target: target() }),
    );
  });
  it.each([
    [{ email: "new@example.test" }, "quyan:user:SetUserEmail"],
    [{ status: 1 }, "quyan:user:SetUserStatus"],
  ])("requires independent authority for %j", async (data, action) => {
    iam.authorizeMany.mockImplementation(async ({ action: current, resources }) =>
      resources.map(() => ({
        decision: current === action ? "ExplicitDeny" : "Allow",
        reason: "test",
        matchedStatements: [],
      })),
    );
    await expect(service.execute("target", data, "actor", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.update).not.toHaveBeenCalled();
  });
  it("requires group-assignment authority on both the user and destination group", async () => {
    await service.execute("target", { groupId: "new-group" }, "actor", request());
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:user:AssignUserGroup",
        resources: [platformUserArn("target"), platformUserGroupArn("new-group")],
      }),
    );
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map((resource: string) => ({
        decision: resource === platformUserGroupArn("new-group") ? "ImplicitDeny" : "Allow",
        reason: "test",
        matchedStatements: [],
      })),
    );
    await expect(service.execute("target", { groupId: "new-group" }, "actor", request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.update).toHaveBeenCalledTimes(1);
  });
  it("rejects an unproven new group privilege and removal of a group Deny", async () => {
    iam.loadGroupPolicies.mockImplementation(async (_account, id) =>
      id === "new-group" ? [{ policyId: "new", document: policy() }] : [],
    );
    await expect(service.execute("target", { groupId: "new-group" }, "actor", request())).rejects.toMatchObject({
      statusCode: 403,
    });
    iam.loadDelegatablePolicies.mockResolvedValue([policy()]);
    await service.execute("target", { groupId: "new-group" }, "actor", request());
    iam.loadGroupPolicies.mockImplementation(async (_account, id) => [
      { policyId: id, document: policy(id === "old" ? "Deny" : "Allow") },
    ]);
    await expect(service.execute("target", { groupId: "new-group" }, "actor", request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.update).toHaveBeenCalledTimes(1);
  });
  it("retains relation scope during group delegation", async () => {
    iam.loadGroupPolicies.mockImplementation(async (_account, id) =>
      id === "new-group"
        ? [
            {
              policyId: id,
              document: policy("Allow", "*"),
              scope: { type: "resource", arn: "acs:quyan:*:owner:user/exact" },
            },
          ]
        : [],
    );
    iam.loadDelegatablePolicies.mockResolvedValue([policy("Allow", "acs:quyan:*:owner:user/exact")]);
    await service.execute("target", { groupId: "new-group" }, "actor", request());
    expect(repository.update).toHaveBeenCalledTimes(1);
  });
  it("cannot omit an unknown candidate scope intersection from the group proof", async () => {
    iam.loadGroupPolicies.mockImplementation(async (_owner, id) =>
      id === "new-group"
        ? [
            {
              policyId: id,
              document: policy("Allow", "acs:quyan:*:owner:user/id-*"),
              scope: { type: "resource", arn: "acs:quyan:*:owner:user/*-1" },
            },
          ]
        : [],
    );
    await expect(service.execute("target", { groupId: "new-group" }, "actor", request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.update).not.toHaveBeenCalled();
  });
  it("root recovery still requires valid candidate policy loading and independent actions", async () => {
    repository.target.mockResolvedValue({ ...target(), recoveryBootstrap: true });
    iam.loadGroupPolicies.mockResolvedValue([{ policyId: "full", document: policy("Allow", "*") }]);
    await service.execute("target", { groupId: "new-group" }, "actor", request());
    expect(iam.loadDelegatablePolicies).toHaveBeenCalled();
    iam.loadGroupPolicies.mockRejectedValue(new Error("invalid policy"));
    await expect(service.execute("target", { groupId: "new-group" }, "actor", request())).rejects.toThrow(
      "invalid policy",
    );
    expect(repository.update).toHaveBeenCalledTimes(1);
  });
  it("does not use bootstrap recovery to delegate an actor's explicitly denied privilege", async () => {
    repository.target.mockResolvedValue({ ...target(), recoveryBootstrap: true });
    iam.loadGroupPolicies.mockResolvedValue([{ policyId: "grant", document: policy() }]);
    iam.loadDelegatablePolicies.mockResolvedValue([policy("Deny")]);
    await expect(service.execute("target", { groupId: "new-group" }, "actor", request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.update).not.toHaveBeenCalled();
  });
  it("does not overestimate unknown new scopes when preserving owner recovery authority", async () => {
    repository.target.mockResolvedValue({ ...target(), accountOwnerId: "target", recoveryBootstrap: true });
    iam.loadGroupPolicies.mockImplementation(async (_account, id) =>
      id === "new-group"
        ? [
            {
              policyId: id,
              document: policy("Allow", "acs:quyan:*:target:user/id-*"),
              scope: { type: "resource", arn: "acs:quyan:*:target:user/*-1" },
            },
          ]
        : [{ policyId: id, document: policy("Allow", "acs:quyan:*:target:user/id-2") }],
    );
    await expect(service.execute("target", { groupId: "new-group" }, "actor", request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.update).not.toHaveBeenCalled();
  });
  it("cannot assign a new Deny to an account owner even during bootstrap recovery", async () => {
    repository.target.mockResolvedValue({ ...target(), accountOwnerId: "target", recoveryBootstrap: true });
    iam.loadGroupPolicies.mockImplementation(async (_owner, id) =>
      id === "new-group" ? [{ policyId: id, document: policy("Deny") }] : [],
    );
    await expect(service.execute("target", { groupId: "new-group" }, "actor", request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.update).not.toHaveBeenCalled();
  });
  it.each([{ groupId: "new-group" }, { status: 0 }, { email: "new@example.test" }])(
    "protects own identity from %j",
    async (data) => {
      repository.target.mockResolvedValue({ ...target(), resource: { ...target().resource, id: "actor", status: 1 } });
      await expect(service.execute("actor", data, "actor", request())).rejects.toMatchObject({ statusCode: 403 });
      expect(repository.update).not.toHaveBeenCalled();
    },
  );
  it("permits self name updates without changing authorization metadata", async () => {
    repository.target.mockResolvedValue({ ...target(), resource: { ...target().resource, id: "actor", status: 1 } });
    await service.execute("actor", { name: "new" }, "actor", request());
    expect(repository.update).toHaveBeenCalledWith(expect.objectContaining({ data: { name: "new" } }));
  });
  it.each([
    undefined,
    { ...request(), user: { userId: "other" } },
    { ...request(), oauthAccessToken: { id: "token" } },
  ])("fails closed without a matching trusted identity", async (req) => {
    await expect(service.execute("target", { name: "new" }, "actor", req as TypedRequest)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.update).not.toHaveBeenCalled();
  });
  it("rejects invalid fields, alias snapshots and readonly impersonation", async () => {
    await expect(service.execute("target", { status: -1 }, "actor", request())).rejects.toMatchObject({
      statusCode: 400,
    });
    repository.target.mockResolvedValue({ ...target(), resource: { ...target().resource, id: "other" } });
    await expect(service.execute("target", { name: "new" }, "actor", request())).rejects.toMatchObject({
      statusCode: 403,
    });
    const req = request();
    req.user = { ...req.user!, impersonatorId: "issuer", impersonationMode: "view" };
    await expect(service.execute("target", { name: "new" }, "actor", req)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.update).not.toHaveBeenCalled();
  });
  it("performs shadow evaluation without another write", async () => {
    expect(await service.execute("target", { name: "new" }, "actor", request(), false)).toBeUndefined();
    expect(repository.recheck).toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });
  it("rechecks revocation in the final write guard", async () => {
    repository.update.mockImplementation(async (guard) => {
      iam.authorizeMany.mockImplementation(async ({ resources }) =>
        resources.map(() => ({ decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] })),
      );
      await guard.users.recheck();
    });
    await expect(service.execute("target", { name: "new" }, "actor", request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("declares native server authorization while retaining replay and validation", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const file = project.addSourceFileAtPath("src/api/controllers/v1/users/user.controller.ts");
    expect(collectIamRoutes([file], process.cwd()).find((row) => row.method === "updateUser")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:user:UpdateUser"],
      resourceKind: "single-resource",
      issues: [],
    });
  });
});
