import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/services/system/platform-management-read-iam.service", () => ({
  PlatformManagementReadIamService: { getInstance: vi.fn() },
}));
vi.mock("@/middleware/auth/local_auth", () => ({ isLocalRequest: vi.fn() }));
vi.mock("fs-extra", () => ({ default: { readJson: vi.fn() } }));
import { OpenApiDocumentService } from "@/services/system/openapi-document.service";
import { OpenApiDocumentRepository } from "@/store/system/openapi-document.repository";
import { env } from "@/config/env";
import { isLocalRequest } from "@/middleware/auth/local_auth";
import fs from "fs-extra";
import { SWAGGER_PATH } from "@/constant/file-path";
import { platformSystemArn } from "@/iam/resources/platform-system-resources";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const testFlag = env.runtime.isTest;
let service: OpenApiDocumentService, repo: any, iam: any, request: TypedRequest;
beforeEach(() => {
  vi.clearAllMocks();
  env.runtime.isTest = true;
  vi.mocked(isLocalRequest).mockReturnValue(false);
  repo = { read: vi.fn().mockResolvedValue({ openapi: "3.0.0", paths: {} }) };
  iam = { read: vi.fn().mockImplementation(async (_a, _r, _q, read) => read()) };
  service = new (OpenApiDocumentService as unknown as new (...args: any[]) => OpenApiDocumentService)(repo, iam);
  request = {
    ip: "192.0.2.1",
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*", "x-file": "untrusted" },
  } as unknown as TypedRequest;
});
afterEach(() => {
  env.runtime.isTest = testFlag;
});
describe("generated OpenAPI IAM read", () => {
  it("reads the fixed platform resource once after authorization", async () => {
    expect(await service.read(request)).toEqual({ openapi: "3.0.0", paths: {} });
    expect(iam.read).toHaveBeenCalledWith(
      "quyan:system:GetOpenApiSpecification",
      platformSystemArn("openapi-spec"),
      request,
      expect.any(Function),
    );
    expect(repo.read).toHaveBeenCalledOnce();
  });
  it("does not open the specification on denial and withholds it on late revocation", async () => {
    iam.read.mockRejectedValue(new Error("fixture deny"));
    await expect(service.read(request)).rejects.toThrow("fixture deny");
    expect(repo.read).not.toHaveBeenCalled();
    iam.read.mockImplementation(async (_a: any, _r: any, _q: any, read: any) => {
      await read();
      throw new Error("fixture revoked");
    });
    await expect(service.read(request)).rejects.toThrow("fixture revoked");
    expect(repo.read).toHaveBeenCalledOnce();
  });
  it("preserves trusted loopback access outside tests and retains the test authorization boundary", async () => {
    vi.mocked(isLocalRequest).mockReturnValue(true);
    env.runtime.isTest = false;
    await service.read(request);
    expect(iam.read).not.toHaveBeenCalled();
    env.runtime.isTest = true;
    await service.read(request);
    expect(iam.read).toHaveBeenCalledOnce();
  });
  it("loads only the server-owned generated path and rejects invalid document shapes", async () => {
    const repository = OpenApiDocumentRepository.getInstance();
    vi.mocked(fs.readJson).mockResolvedValue({ openapi: "3.0.0" });
    expect(await repository.read()).toEqual({ openapi: "3.0.0" });
    expect(fs.readJson).toHaveBeenCalledWith(SWAGGER_PATH);
    for (const document of [null, [], "fixture string"]) {
      vi.mocked(fs.readJson).mockResolvedValue(document);
      await expect(repository.read()).rejects.toThrow("Generated OpenAPI specification is invalid");
    }
  });
  it("declares fixed native metadata while preserving local-or-jwt authentication", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/_unversioned/docs.controller.ts");
    expect(collectIamRoutes(project.getSourceFiles(), process.cwd())[0]).toMatchObject({
      key: "GET /docs/openapi.json",
      security: ["local-or-jwt"],
      coverage: "explicit",
      actions: ["quyan:system:GetOpenApiSpecification"],
      issues: [],
    });
  });
});
