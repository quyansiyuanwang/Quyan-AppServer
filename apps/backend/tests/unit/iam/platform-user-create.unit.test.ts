import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_USER_GROUP_PERMISSIONS, DEFAULT_USER_GROUP_USERNAME } from "@quyan/shared";
vi.mock("@/store/users/platform-user-create.repository", () => ({
  PlatformUserCreateRepository: { getInstance: vi.fn() },
}));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
import { PlatformUserCreateIamService } from "@/services/users/platform-user-create-iam.service";
import { legacyPermissionsToPolicy } from "@/iam/legacy-policy";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import {
  platformUserArn,
  platformUserGroupArn,
  platformUserDirectoryArn,
} from "@/iam/resources/platform-user-resources";
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
    destination: vi.fn(),
    authorizationRevision: vi.fn(),
    recheck: vi.fn(),
    create: vi.fn(),
    created: vi.fn(),
  },
  service = new PlatformUserCreateIamService(iam, snapshots, repository);
const data = () => ({ username: "created_user", password: "$2b$12$" + "a".repeat(53), name: "Created" });
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*", "x-account-id": "forged" },
    secure: true,
    ip: "192.0.2.20",
  }) as unknown as TypedRequest;
const group = () => ({
  id: "default",
  username: DEFAULT_USER_GROUP_USERNAME,
  level: 10,
  updateTime: new Date(0),
  permissions: [...DEFAULT_USER_GROUP_PERMISSIONS],
  recoveryBootstrap: false,
});
const policy = (Effect = "Allow", Resource = "acs:quyan:*:created:user/*") =>
  parseIamPolicy({ Version: "1", Statement: { Effect, Action: "quyan:ram:UpdateUser", Resource } }).document;
beforeEach(() => {
  vi.resetAllMocks();
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "matched-allow", matchedStatements: [] })),
  );
  iam.loadGroupPolicies.mockImplementation(async (id, groupId) => [
    { policyId: "legacy:group:" + groupId, document: legacyPermissionsToPolicy(DEFAULT_USER_GROUP_PERMISSIONS, id) },
  ]);
  iam.loadDelegatablePolicies.mockResolvedValue([]);
  snapshots.snapshot.mockResolvedValue({
    group: { id: "global", updateTime: new Date(0) },
    users: [
      { id: "actor", updateTime: new Date(0) },
      { id: "owner", updateTime: new Date(0) },
    ],
  });
  repository.destination.mockResolvedValue(group());
  repository.authorizationRevision.mockResolvedValue("b".repeat(64));
  repository.created.mockResolvedValue(async () => {});
  repository.create.mockImplementation(async (guard) => {
    await guard.authorizeCreated("created");
    await guard.users.recheck();
    return { id: "created", status: 1, name: "Created" };
  });
});
describe("platform user creation authorization", () => {
  it("checks the fixed directory and real generated user without trusting client IDs", async () => {
    const result = await service.execute(
      { ...data(), id: "forged", accountOwnerId: "forged", permissionAdds: ["*"], status: 0 },
      "actor",
      request(),
    );
    expect(result).toMatchObject({ id: "created", status: 1 });
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:user:CreateUser", resources: [platformUserDirectoryArn()] }),
    );
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:user:CreateUser", resources: [platformUserArn("created")] }),
    );
    expect(repository.create.mock.calls[0]![0].data).toEqual(data());
    expect(iam.loadGroupPolicies).toHaveBeenCalledWith("created", "default", { allowGlobalManaged: true });
  });
  it.each(["directory", "generated"])("denies a missing %s grant", async (boundary) => {
    const denied = boundary === "directory" ? platformUserDirectoryArn() : platformUserArn("created");
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map((resource: string) => ({
        decision: resource === denied ? "ExplicitDeny" : "Allow",
        reason: "test",
        matchedStatements: [],
      })),
    );
    await expect(service.execute(data(), "actor", request())).rejects.toMatchObject({ statusCode: 403 });
    if (boundary === "directory") expect(repository.destination).not.toHaveBeenCalled();
  });
  it("requires assignment on both the generated user and explicit destination", async () => {
    iam.loadGroupPolicies.mockResolvedValue([]);
    await service.execute({ ...data(), groupId: "default" }, "actor", request());
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:user:AssignUserGroup",
        resources: [platformUserArn("created"), platformUserGroupArn("default")],
      }),
    );
    iam.authorizeMany.mockImplementation(async ({ action, resources }) =>
      resources.map((resource: string) => ({
        decision:
          action.endsWith("AssignUserGroup") && resource === platformUserArn("created") ? "ImplicitDeny" : "Allow",
        reason: "test",
        matchedStatements: [],
      })),
    );
    await expect(service.execute({ ...data(), groupId: "default" }, "actor", request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("never gives an explicitly selected group the registration baseline exception", async () => {
    await expect(service.execute({ ...data(), groupId: "default" }, "actor", request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("does not transfer an actor Deny through the default exception", async () => {
    const denied = legacyPermissionsToPolicy(DEFAULT_USER_GROUP_PERMISSIONS, "created", "Deny")!;
    iam.loadDelegatablePolicies.mockResolvedValue([denied]);
    await expect(service.execute(data(), "actor", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["extra-permissions", "extra-policy", "changed-baseline", "forged-origin"])(
    "requires the exact persisted default baseline: %s",
    async (change) => {
      if (change === "extra-permissions") repository.destination.mockResolvedValue({ ...group(), permissions: [] });
      if (change === "extra-policy")
        iam.loadGroupPolicies.mockResolvedValue([{ policyId: "extra", document: policy() }]);
      if (change === "changed-baseline")
        iam.loadGroupPolicies.mockResolvedValue([{ policyId: "legacy:group:default", document: policy() }]);
      if (change === "forged-origin")
        iam.loadGroupPolicies.mockImplementation(async (id) => [
          { policyId: "user-json", document: legacyPermissionsToPolicy(DEFAULT_USER_GROUP_PERMISSIONS, id) },
        ]);
      await expect(service.execute(data(), "actor", request())).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("checks candidate scoped authority against source grants", async () => {
    iam.loadGroupPolicies.mockResolvedValue([
      {
        policyId: "candidate",
        document: policy("Allow", "acs:quyan:*:created:user/*"),
        scope: { type: "resource", arn: "acs:quyan:*:created:user/exact" },
      },
    ]);
    iam.loadDelegatablePolicies.mockResolvedValue([policy("Allow", "acs:quyan:*:created:user/exact")]);
    await service.execute({ ...data(), groupId: "default" }, "actor", request());
    iam.loadDelegatablePolicies.mockResolvedValue([]);
    await expect(service.execute({ ...data(), groupId: "default" }, "actor", request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("does not discard unknown candidate wildcard intersections", async () => {
    iam.loadGroupPolicies.mockResolvedValue([
      {
        policyId: "candidate",
        document: policy("Allow", "acs:quyan:*:created:user/id-*"),
        scope: { type: "resource", arn: "acs:quyan:*:created:user/*-1" },
      },
    ]);
    await expect(service.execute(data(), "actor", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("limits configured root recovery to the actor's remaining authority", async () => {
    repository.destination.mockResolvedValue({ ...group(), recoveryBootstrap: true });
    iam.loadGroupPolicies.mockResolvedValue([{ policyId: "candidate", document: policy() }]);
    await service.execute({ ...data(), groupId: "default" }, "actor", request());
    iam.loadDelegatablePolicies.mockResolvedValue([policy("Deny")]);
    await expect(service.execute({ ...data(), groupId: "default" }, "actor", request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("rechecks candidate hashes after inserting the real user", async () => {
    repository.create.mockImplementation(async (guard) => {
      await guard.authorizeCreated("created");
      iam.loadGroupPolicies.mockResolvedValue([{ policyId: "new", document: policy() }]);
      await guard.authorizeCreated("created");
    });
    await expect(service.execute(data(), "actor", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks revocation before final commit", async () => {
    repository.create.mockImplementation(async (guard) => {
      await guard.authorizeCreated("created");
      iam.authorizeMany.mockImplementation(async ({ resources }) =>
        resources.map(() => ({ decision: "ExplicitDeny", reason: "test", matchedStatements: [] })),
      );
      await guard.users.recheck();
    });
    await expect(service.execute(data(), "actor", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a changed generated identity within one transaction", async () => {
    repository.create.mockImplementation(async (guard) => {
      await guard.authorizeCreated("created");
      await guard.authorizeCreated("other");
    });
    await expect(service.execute(data(), "actor", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["missing", "different-actor", "different-principal", "oauth", "readonly"])(
    "rejects the %s context",
    async (kind) => {
      const req = request();
      if (kind === "different-principal") req.authContext!.principalUserId = "other";
      if (kind === "oauth") req.oauthAccessToken = {} as never;
      if (kind === "readonly") req.user = { ...req.user!, impersonatorId: "admin", impersonationMode: "view" };
      await expect(
        service.execute(data(), kind === "different-actor" ? "other" : "actor", kind === "missing" ? undefined : req),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(repository.create).not.toHaveBeenCalled();
    },
  );
  it.each([{ username: "!bad" }, { password: "raw-password" }, { email: "invalid" }, { groupId: "" }])(
    "rejects invalid fields %j without persistence",
    async (invalid) => {
      await expect(service.execute({ ...data(), ...invalid }, "actor", request())).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(repository.create).not.toHaveBeenCalled();
    },
  );
  it("inspects the actual shadow-created resource without a second mutation", async () => {
    await service.inspectCreated("created", data(), "actor", request());
    expect(repository.created).toHaveBeenCalledWith(
      expect.objectContaining({ subjectUserId: "actor" }),
      "created",
      data(),
      group(),
    );
    expect(repository.create).not.toHaveBeenCalled();
  });
  it("declares native collection authorization with replay and input validation", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const file = project.addSourceFileAtPath("src/api/controllers/v1/users/user.controller.ts");
    expect(collectIamRoutes([file], process.cwd()).find((row) => row.method === "createUser")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:user:CreateUser"],
      resourceKind: "collection",
      issues: [],
    });
  });
});
