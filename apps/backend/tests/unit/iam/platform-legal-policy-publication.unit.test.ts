import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/content/platform-legal-policy-publication.repository", () => ({
  PlatformLegalPolicyPublicationRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/content/platform-legal-policy-read.repository", () => ({
  PlatformLegalPolicyReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/content/platform-legal-policy-write.repository", () => ({
  PlatformLegalPolicyWriteRepository: { getInstance: vi.fn() },
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
import { PlatformLegalPolicyPublicationIamService } from "@/services/legal-policy/platform-legal-policy-publication-iam.service";
import { PlatformLegalPolicyPublicationRepository } from "@/store/content/platform-legal-policy-publication.repository";
import {
  platformLegalPolicyPublishResources,
  platformLegalPolicyUnpublishResources,
} from "@/iam/request/platform-legal-policy-resource-resolvers";
import { platformLegalPolicyArn } from "@/iam/resources/platform-legal-policy-resources";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
let service: PlatformLegalPolicyPublicationIamService, iam: any, repo: any, identities: any, request: TypedRequest;
beforeEach(() => {
  vi.clearAllMocks();
  iam = { authorizeMany: vi.fn().mockResolvedValue([allow, allow]) };
  const transition = { operation: "PublishVersion", target: { id: "new" }, affected: [{ id: "new" }, { id: "old" }] };
  repo = {
    prepare: vi.fn().mockResolvedValue(transition),
    commit: vi.fn().mockResolvedValue({ id: "new", publishStatus: "published" }),
  };
  identities = {
    snapshot: vi.fn().mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] }),
    recheck: vi.fn(),
  };
  service = new (PlatformLegalPolicyPublicationIamService as unknown as new (
    ...args: any[]
  ) => PlatformLegalPolicyPublicationIamService)(iam, repo, identities);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    params: { id: "new" },
    headers: { "x-action": "*" },
  } as unknown as TypedRequest;
});
describe("legal policy publication resource set authorization", () => {
  it("authorizes every affected version and binds the final callback to the same resource set", async () => {
    expect(await service.change("PublishVersion", "new", "actor", request)).toMatchObject({
      row: { id: "new" },
      affectedIds: ["new", "old"],
    });
    const guard = repo.commit.mock.calls[0][0];
    await guard.users.recheck();
    expect(iam.authorizeMany).toHaveBeenCalledTimes(2);
    expect(iam.authorizeMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "quyan:legal_policy:PublishVersion",
        resources: [platformLegalPolicyArn("new"), platformLegalPolicyArn("old")],
      }),
    );
  });
  it("does not commit if any affected version is denied or a decision is missing", async () => {
    for (const result of [[allow, { ...allow, decision: "ExplicitDeny" }], [allow], undefined]) {
      iam.authorizeMany.mockResolvedValue(result);
      await expect(service.change("PublishVersion", "new", "actor", request)).rejects.toMatchObject({
        statusCode: 403,
      });
    }
    expect(repo.commit).not.toHaveBeenCalled();
  });
  it("refuses duplicate or empty effect sets", async () => {
    for (const affected of [[], [{ id: "new" }, { id: "new" }]]) {
      repo.prepare.mockResolvedValue({ operation: "PublishVersion", target: { id: "new" }, affected });
      await expect(service.change("PublishVersion", "new", "actor", request)).rejects.toMatchObject({
        statusCode: 403,
      });
    }
    expect(iam.authorizeMany).not.toHaveBeenCalled();
    expect(repo.commit).not.toHaveBeenCalled();
  });
  it("rejects final permission or qualification loss and evaluates shadow without mutation", async () => {
    await service.change("PublishVersion", "new", "actor", request);
    const guard = repo.commit.mock.calls[0][0];
    identities.recheck.mockRejectedValue(new Error("fixture revoked"));
    await expect(guard.users.recheck()).rejects.toThrow("fixture revoked");
    identities.recheck.mockReset();
    repo.commit.mockClear();
    expect(await service.change("PublishVersion", "new", "actor", request, false)).toBeUndefined();
    expect(repo.commit).not.toHaveBeenCalled();
  });
  it("does not trust actor spoofing or unsupported operations", async () => {
    await expect(service.change("PublishVersion", "new", "other", request)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.change("DeleteVersion" as any, "new", "actor", request)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repo.prepare).not.toHaveBeenCalled();
  });
  it("resolves complete real publication sets and declares batch route metadata", async () => {
    vi.mocked(PlatformLegalPolicyPublicationRepository.getInstance).mockReturnValue(repo);
    const principal = {
      subjectUserId: "actor",
      principalUserId: "actor",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    };
    expect(await platformLegalPolicyPublishResources({ request, principal })).toEqual([
      platformLegalPolicyArn("new"),
      platformLegalPolicyArn("old"),
    ]);
    expect(await platformLegalPolicyUnpublishResources({ request, principal })).toEqual([
      platformLegalPolicyArn("new"),
      platformLegalPolicyArn("old"),
    ]);
    expect(repo.prepare).toHaveBeenLastCalledWith(principal, "new", "UnpublishVersion");
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/legal-policy/legal-policy.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const [method, action] of [
      ["publishPolicy", "PublishVersion"],
      ["unpublishPolicy", "UnpublishVersion"],
    ])
      expect(routes.find((r) => r.method === method)).toMatchObject({
        coverage: "explicit",
        resourceKind: "batch",
        actions: ["quyan:legal_policy:" + action],
        issues: [],
      });
  });
});
