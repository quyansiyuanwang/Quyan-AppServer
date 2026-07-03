import fs from "fs-extra";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request, { type Test } from "supertest";
import { createApp } from "../../src/app";
import type { Express } from "express";
import { prisma } from "../../src/config/database";
import { hashPassword } from "../../src/util/crypto";
import { Permission } from "../../src/constant/permission";
import { MANAGED_STATUS } from "../../src/constant/status";
import { withReplayProtection } from "../util/replay-protection-test-helper";

type HttpMethod = "get" | "post" | "put" | "patch" | "delete" | "head" | "options";

interface OpenApiSchema {
  type?: string;
}

interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  schema?: OpenApiSchema;
}

interface OpenApiRequestBody {
  content?: Record<string, unknown>;
}

interface OpenApiOperation {
  responses?: Record<string, unknown>;
  security?: Array<Record<string, unknown>>;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
}

interface OpenApiPathItem {
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  patch?: OpenApiOperation;
  delete?: OpenApiOperation;
  head?: OpenApiOperation;
  options?: OpenApiOperation;
}

interface OpenApiDocument {
  paths: Record<string, OpenApiPathItem>;
}

interface OperationDescriptor {
  path: string;
  method: HttpMethod;
  operation: OpenApiOperation;
}

const HTTP_METHODS: HttpMethod[] = ["get", "post", "put", "patch", "delete", "head", "options"];
const SWAGGER_PATH = path.resolve(process.cwd(), "src/build/swagger.json");
const openApi = fs.readJsonSync(SWAGGER_PATH) as OpenApiDocument;
const OPERATION_STATUS_OVERRIDES: Record<string, number[]> = {
  "GET /articles/default": [204],
};

function collectOperations(document: OpenApiDocument): OperationDescriptor[] {
  const operations: OperationDescriptor[] = [];

  for (const [routePath, pathItem] of Object.entries(document.paths))
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      operations.push({
        path: routePath,
        method,
        operation,
      });
    }

  return operations.sort((a, b) => {
    const methodCompare = a.method.localeCompare(b.method);
    if (methodCompare !== 0) return methodCompare;
    return a.path.localeCompare(b.path);
  });
}

function buildPathFromTemplate(pathTemplate: string): string {
  return pathTemplate.replace(/\{([^}]+)\}/g, (_match, rawName: string) => encodeURIComponent(pathParamValue(rawName)));
}

function pathParamValue(rawName: string): string {
  const name = rawName.toLowerCase();

  if (name.includes("ip")) return "127.0.0.1";
  if (name.includes("slug")) return "openapi-contract-missing-slug";
  if (name.includes("modelandaction")) return "gemini-2.5-pro:generateContent";
  if (name.includes("model")) return "gpt-4o";
  if (name.includes("id")) return "openapi-contract-id";

  return "openapi-contract-value";
}

function buildInvalidQuery(operation: OpenApiOperation): Record<string, string> {
  const query: Record<string, string> = {};

  for (const parameter of operation.parameters ?? []) {
    if (parameter.in !== "query" || !parameter.required) continue;

    const type = parameter.schema?.type;
    if (type === "number" || type === "integer") query[parameter.name] = "not-a-number";
    else if (type === "boolean") query[parameter.name] = "not-a-boolean";
    else query[parameter.name] = "invalid";
  }

  return query;
}

function buildInvalidBody(operation: OpenApiOperation): unknown | undefined {
  if (!operation.requestBody) return undefined;
  return {};
}

function createRequestBuilder(app: Express, method: HttpMethod, routePath: string): Test {
  switch (method) {
    case "get":
      return request(app).get(routePath);
    case "post":
      return request(app).post(routePath);
    case "put":
      return request(app).put(routePath);
    case "patch":
      return request(app).patch(routePath);
    case "delete":
      return request(app).delete(routePath);
    case "head":
      return request(app).head(routePath);
    case "options":
      return request(app).options(routePath);
    default:
      throw new Error(`Unsupported method: ${method}`);
  }
}

function operationDisplayName(descriptor: OperationDescriptor): string {
  return `${descriptor.method.toUpperCase()} ${descriptor.path}`;
}

function usesJwtSecurity(operation: OpenApiOperation): boolean {
  return (operation.security ?? []).some((requirement) => Object.keys(requirement).includes("jwt"));
}

function isMutationMethod(method: HttpMethod): boolean {
  return method === "post" || method === "put" || method === "patch" || method === "delete";
}

function getDocumentedStatuses(operation: OpenApiOperation): Set<number> {
  const statuses = new Set<number>();

  for (const code of Object.keys(operation.responses ?? {})) if (/^\d+$/.test(code)) statuses.add(Number(code));

  return statuses;
}

describe("OpenAPI Operations Contract", () => {
  let app: Express;
  let testGroupId = "";
  let testUserId = "";
  let testUsername = "";
  const testPassword = "test_password";
  const monthlyPassTemplateIds: string[] = [];
  const operations = collectOperations(openApi);

  const loginAsContractUser = async () => {
    const loginBody = {
      username: testUsername,
      password: testPassword,
      agreedToLegalPolicies: true,
    };

    const loginResponse = await withReplayProtection(request(app).post("/v1/auth/login"), loginBody, "/v1/auth/login")
      .send(loginBody)
      .expect((res) => {
        if (res.status !== 200) throw new Error(`OpenAPI contract login failed: ${res.status}`);
      });

    const token = loginResponse.body?.data?.access_token;
    if (!token) throw new Error("OpenAPI contract login succeeded but did not return an access token");

    return token as string;
  };

  const authedGet = async (routePath: string) => {
    const accessToken = await loginAsContractUser();
    return request(app).get(routePath).set("Authorization", `Bearer ${accessToken}`);
  };

  const authedReplayPost = async (routePath: string, body: Record<string, unknown> = {}) => {
    const accessToken = await loginAsContractUser();
    return withReplayProtection(request(app).post(routePath), body, routePath)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body);
  };

  const createDraftMonthlyPassTemplate = async () => {
    const template = await prisma.monthlyPassTemplate.create({
      data: {
        name: `openapi_contract_monthly_pass_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        description: "OpenAPI contract monthly pass template",
        publishStatus: "draft",
        publishedAt: null,
        defaultQuota: 12.5,
        dailyQuota: null,
        quotaUnit: "amount",
        quotaWindowHours: null,
        allowedModels: null,
        allowedChannels: null,
        status: MANAGED_STATUS.ENABLED,
      },
    });

    monthlyPassTemplateIds.push(template.id);
    return template;
  };

  beforeAll(async () => {
    app = createApp();

    const shortSuffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 100)}`;
    const group = await prisma.group.create({
      data: {
        username: `ocg_${shortSuffix}`,
        name: "OpenAPI Contract Test Group",
        level: 1,
        permissions: JSON.stringify(Object.values(Permission)),
      },
    });
    testGroupId = group.id;

    const user = await prisma.user.create({
      data: {
        username: `ocu_${shortSuffix}`,
        password: hashPassword(testPassword),
        groupId: testGroupId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
    testUserId = user.id;
    testUsername = user.username;

    await loginAsContractUser();
  });

  afterAll(async () => {
    if (monthlyPassTemplateIds.length > 0)
      await prisma.monthlyPassTemplate
        .deleteMany({
          where: {
            id: {
              in: monthlyPassTemplateIds,
            },
          },
        })
        .catch(() => undefined);

    if (testUserId) await prisma.user.deleteMany({ where: { id: testUserId } }).catch(() => undefined);
    if (testGroupId) await prisma.group.deleteMany({ where: { id: testGroupId } }).catch(() => undefined);
  });

  it("should publish and unpublish monthly pass template endpoints with documented response shape", async () => {
    const template = await createDraftMonthlyPassTemplate();

    const listBeforePublishResponse = await authedGet("/v1/monthly-passes/templates/published");

    expect(listBeforePublishResponse.status).toBe(200);
    expect(Array.isArray(listBeforePublishResponse.body?.data)).toBe(true);
    expect(listBeforePublishResponse.body.data.some((item: { id: string }) => item.id === template.id)).toBe(false);

    const publishResponse = await authedReplayPost(`/v1/monthly-passes/templates/${template.id}/publish`);

    expect(publishResponse.status).toBe(200);
    expect(publishResponse.body.code).toBe(0);
    expect(publishResponse.body.data).toMatchObject({
      id: template.id,
      name: template.name,
      publishStatus: "published",
      status: MANAGED_STATUS.ENABLED,
    });
    expect(publishResponse.body.data.publishedAt).toEqual(expect.any(String));

    const listAfterPublishResponse = await authedGet("/v1/monthly-passes/templates/published");

    expect(listAfterPublishResponse.status).toBe(200);
    expect(listAfterPublishResponse.body.code).toBe(0);

    const publishedTemplate = listAfterPublishResponse.body.data.find(
      (item: { id: string }) => item.id === template.id,
    );
    expect(publishedTemplate).toMatchObject({
      id: template.id,
      name: template.name,
      publishStatus: "published",
      status: MANAGED_STATUS.ENABLED,
    });
    expect(publishedTemplate.publishedAt).toEqual(expect.any(String));

    const unpublishResponse = await authedReplayPost(`/v1/monthly-passes/templates/${template.id}/unpublish`);

    expect(unpublishResponse.status).toBe(200);
    expect(unpublishResponse.body.code).toBe(0);
    expect(unpublishResponse.body.data).toMatchObject({
      id: template.id,
      name: template.name,
      publishStatus: "draft",
      status: MANAGED_STATUS.ENABLED,
    });
    expect(unpublishResponse.body.data.publishedAt ?? null).toBeNull();

    const listAfterUnpublishResponse = await authedGet("/v1/monthly-passes/templates/published");

    expect(listAfterUnpublishResponse.status).toBe(200);
    expect(listAfterUnpublishResponse.body.code).toBe(0);
    expect(listAfterUnpublishResponse.body.data.some((item: { id: string }) => item.id === template.id)).toBe(false);
  });

  for (const descriptor of operations) {
    const testName = operationDisplayName(descriptor);

    it(testName, async () => {
      const concretePath = buildPathFromTemplate(descriptor.path);
      const query = buildInvalidQuery(descriptor.operation);
      const body = buildInvalidBody(descriptor.operation);
      const replayBody = body === undefined ? undefined : body;

      let requestBuilder = createRequestBuilder(app, descriptor.method, concretePath);

      if (usesJwtSecurity(descriptor.operation)) {
        const accessToken = await loginAsContractUser();
        requestBuilder = requestBuilder.set("Authorization", `Bearer ${accessToken}`);
      }

      if (isMutationMethod(descriptor.method))
        requestBuilder = withReplayProtection(requestBuilder, replayBody, concretePath);

      if (Object.keys(query).length > 0) requestBuilder = requestBuilder.query(query);
      if (replayBody !== undefined) requestBuilder = requestBuilder.send(replayBody as Record<string, unknown>);

      const response = await requestBuilder;

      expect(response.status).toBeLessThan(500);

      if (usesJwtSecurity(descriptor.operation) && descriptor.path !== "/v1/auth/logout")
        expect(response.status).not.toBe(401);

      const documentedStatuses = getDocumentedStatuses(descriptor.operation);
      if (documentedStatuses.size === 0) return;

      const runtimeValidationStatuses = new Set([400, 401, 403, 404, 405, 409, 410, 415, 422, 429]);
      const overrideStatuses = OPERATION_STATUS_OVERRIDES[testName] ?? [];
      const allowedStatuses = new Set([...documentedStatuses, ...runtimeValidationStatuses, ...overrideStatuses]);

      expect(allowedStatuses.has(response.status)).toBe(true);
    });
  }
});
