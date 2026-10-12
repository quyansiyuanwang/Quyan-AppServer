vi.mock("@/store/content/platform-legal-policy-publication.repository", () => ({
  PlatformLegalPolicyPublicationRepository: { getInstance: vi.fn() },
}));
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/content/platform-legal-policy-write.repository", () => ({
  PlatformLegalPolicyWriteRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/content/platform-legal-policy-read.repository", () => ({
  PlatformLegalPolicyReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    iamAccountDenied: () =>
      new ForbiddenError("fixture deny", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { PlatformLegalPolicyWriteIamService } from "@/services/legal-policy/platform-legal-policy-write-iam.service";
import { PlatformLegalPolicyWriteRepository } from "@/store/content/platform-legal-policy-write.repository";
import {
  platformLegalPolicyArn,
  platformLegalPolicyCreationArn,
} from "@/iam/resources/platform-legal-policy-resources";
import {
  platformLegalPolicyCreateResource,
  platformLegalPolicyUpdateResource,
  platformLegalPolicyDeleteResource,
} from "@/iam/request/platform-legal-policy-resource-resolvers";
import { LegalPolicyType, Permission, getIamActionDefinition } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
const input = { policyType: LegalPolicyType.TERMS_OF_SERVICE, title: "fixture", content: "fixture content" };
let service: PlatformLegalPolicyWriteIamService, iam: any, repo: any, identities: any, request: TypedRequest;
beforeEach(() => {
  vi.clearAllMocks();
  iam = { authorize: vi.fn().mockResolvedValue(allow) };
  repo = {
    create: vi.fn().mockResolvedValue({ id: "version" }),
    update: vi.fn().mockResolvedValue({ id: "version" }),
    remove: vi.fn().mockResolvedValue({ id: "version" }),
    target: vi.fn().mockResolvedValue({ id: "version", status: 1 }),
  };
  identities = {
    snapshot: vi.fn().mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] }),
    recheck: vi.fn(),
  };
  service = new (PlatformLegalPolicyWriteIamService as unknown as new (
    ...args: any[]
  ) => PlatformLegalPolicyWriteIamService)(iam, repo, identities);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    body: input,
    params: { id: "version" },
    headers: { "x-action": "*", "x-account-id": "foreign" },
  } as unknown as TypedRequest;
});
describe("platform legal draft write authorization", () => {
  it("requires the type creation boundary and binds transaction checks to the real version", async () => {
    await service.create(input, "actor", request);
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:legal_policy:CreateVersion",
        resource: platformLegalPolicyCreationArn(input.policyType),
      }),
    );
    const guard = repo.create.mock.calls[0][1];
    expect(guard.permission).toBe(Permission.LEGAL_POLICY_CREATE);
    await guard.recheckVersion("new-version");
    await guard.users.recheck();
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ resource: platformLegalPolicyArn("new-version") }),
    );
    expect(identities.recheck).toHaveBeenCalledTimes(2);
  });
  it("selects existing records with the exact management permission and server Action", async () => {
    await service.change("UpdateVersion", "version", { title: "changed" }, "actor", request);
    expect(repo.target).toHaveBeenCalledWith(
      expect.objectContaining({ accountOwnerId: "owner" }),
      "version",
      Permission.LEGAL_POLICY_UPDATE,
    );
    await service.change("DeleteVersion", "version", {}, "actor", request);
    expect(repo.target).toHaveBeenLastCalledWith(expect.anything(), "version", Permission.LEGAL_POLICY_DELETE);
    expect(iam.authorize.mock.calls.map((c: any) => c[0].action)).toEqual([
      "quyan:legal_policy:UpdateVersion",
      "quyan:legal_policy:DeleteVersion",
    ]);
  });
  it("does not mutate on Deny, missing records, invalid input or actor spoofing", async () => {
    iam.authorize.mockResolvedValue({ ...allow, decision: "ExplicitDeny" });
    await expect(service.create(input, "actor", request)).rejects.toMatchObject({ statusCode: 403 });
    repo.target.mockResolvedValue(null);
    await expect(service.change("DeleteVersion", "missing", {}, "actor", request)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.create({ ...input, Principal: "*" } as any, "actor", request)).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(
      service.change("UpdateVersion", "version", { status: 1 } as any, "actor", request),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.create(input, "other", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.remove).not.toHaveBeenCalled();
  });
  it("rejects policy revocation from the transaction's final callbacks", async () => {
    await service.change("UpdateVersion", "version", { title: "changed" }, "actor", request);
    const guard = repo.update.mock.calls[0][2];
    iam.authorize.mockResolvedValue(undefined);
    await expect(guard.recheckVersion("version")).rejects.toMatchObject({ statusCode: 403 });
    identities.recheck.mockRejectedValue(new Error("fixture revoked"));
    await expect(guard.users.recheck()).rejects.toThrow("fixture revoked");
  });
  it("does not persist shadow drafts or changes", async () => {
    expect(await service.create(input, "actor", request, false)).toBeUndefined();
    expect(await service.change("DeleteVersion", "version", {}, "actor", request, false)).toBeUndefined();
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.remove).not.toHaveBeenCalled();
  });
  it("resolves actual IDs and protocol-defined creation types instead of caller accounts", async () => {
    vi.mocked(PlatformLegalPolicyWriteRepository.getInstance).mockReturnValue(repo);
    const principal = {
      subjectUserId: "actor",
      principalUserId: "actor",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    };
    expect(await platformLegalPolicyCreateResource({ request, principal })).toBe(
      platformLegalPolicyCreationArn(input.policyType),
    );
    expect(await platformLegalPolicyUpdateResource({ request, principal })).toBe(platformLegalPolicyArn("version"));
    repo.target.mockResolvedValue(null);
    expect(await platformLegalPolicyDeleteResource({ request, principal })).toBeUndefined();
  });
  it("declares independent native draft routes while publication remains separate", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/legal-policy/legal-policy.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const [method, operation, permission] of [
      ["createPolicy", "CreateVersion", Permission.LEGAL_POLICY_CREATE],
      ["updatePolicy", "UpdateVersion", Permission.LEGAL_POLICY_UPDATE],
      ["deletePolicy", "DeleteVersion", Permission.LEGAL_POLICY_DELETE],
    ] as const) {
      expect(routes.find((r) => r.method === method)).toMatchObject({
        coverage: "explicit",
        actions: ["quyan:legal_policy:" + operation],
        issues: [],
      });
      expect(getIamActionDefinition("quyan:legal_policy:" + operation)).toMatchObject({
        authorizationBoundary: "platform",
        legacyPermission: permission,
      });
    }
  });
});
