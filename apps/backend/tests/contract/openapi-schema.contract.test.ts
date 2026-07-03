import fs from "fs-extra";
import path from "path";
import { describe, expect, it } from "vitest";

type HttpMethod = "get" | "post" | "put" | "patch" | "delete" | "head" | "options";

interface OpenApiParameter {
  name: string;
  in: string;
}

interface OpenApiOperation {
  operationId?: string;
  responses?: Record<string, unknown>;
  parameters?: OpenApiParameter[];
  security?: Array<Record<string, unknown>>;
}

interface OpenApiPathItem {
  parameters?: OpenApiParameter[];
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  patch?: OpenApiOperation;
  delete?: OpenApiOperation;
  head?: OpenApiOperation;
  options?: OpenApiOperation;
}

interface OpenApiDocument {
  openapi: string;
  paths: Record<string, OpenApiPathItem>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
  securityDefinitions?: Record<string, unknown>;
}

interface OperationDescriptor {
  path: string;
  method: HttpMethod;
  operation: OpenApiOperation;
  pathLevelParameters: OpenApiParameter[];
}

const HTTP_METHODS: HttpMethod[] = ["get", "post", "put", "patch", "delete", "head", "options"];
const SWAGGER_PATH = path.resolve(process.cwd(), "src/build/swagger.json");
const openApi = fs.readJsonSync(SWAGGER_PATH) as OpenApiDocument;

function collectOperations(document: OpenApiDocument): OperationDescriptor[] {
  const operations: OperationDescriptor[] = [];

  for (const [routePath, pathItem] of Object.entries(document.paths)) {
    const pathLevelParameters = pathItem.parameters ?? [];

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      operations.push({
        path: routePath,
        method,
        operation,
        pathLevelParameters,
      });
    }
  }

  return operations;
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolveLocalRef(document: unknown, ref: string): unknown {
  if (!ref.startsWith("#/")) throw new Error(`Only local refs are supported, got: ${ref}`);

  const segments = ref
    .slice(2)
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(decodeJsonPointerSegment);

  let current: unknown = document;

  for (const segment of segments)
    if (current && typeof current === "object" && segment in (current as Record<string, unknown>))
      current = (current as Record<string, unknown>)[segment];
    else throw new Error(`Unresolvable ref '${ref}' at segment '${segment}'`);

  return current;
}

function collectRefs(node: unknown, refs: Set<string>): void {
  if (!node) return;

  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, refs);
    return;
  }

  if (typeof node !== "object") return;

  const objectNode = node as Record<string, unknown>;

  for (const [key, value] of Object.entries(objectNode)) {
    if (key === "$ref" && typeof value === "string") {
      refs.add(value);
      continue;
    }

    collectRefs(value, refs);
  }
}

describe("OpenAPI Schema Contract", () => {
  const operations = collectOperations(openApi);

  it("should expose monthly pass publish endpoints and operationIds", () => {
    const publishedList = openApi.paths["/v1/monthly-passes/templates/published"]?.get;
    const publish = openApi.paths["/v1/monthly-passes/templates/{id}/publish"]?.post;
    const unpublish = openApi.paths["/v1/monthly-passes/templates/{id}/unpublish"]?.post;

    expect(publishedList?.operationId).toBe("MonthlyPassControllerListPublishedTemplates");
    expect(publish?.operationId).toBe("MonthlyPassControllerPublishTemplate");
    expect(unpublish?.operationId).toBe("MonthlyPassControllerUnpublishTemplate");

    expect(publishedList?.security?.some((requirement) => "jwt" in requirement)).toBe(true);
    expect(publish?.security?.some((requirement) => "jwt" in requirement)).toBe(true);
    expect(unpublish?.security?.some((requirement) => "jwt" in requirement)).toBe(true);
  });

  it("should expose a valid OpenAPI document shape", () => {
    expect(openApi.openapi).toMatch(/^3\./);
    expect(Object.keys(openApi.paths).length).toBeGreaterThan(0);
    expect(operations.length).toBeGreaterThan(0);
  });

  it("should provide unique operationId and non-empty responses for every operation", () => {
    const operationIds = new Set<string>();

    for (const { path: routePath, method, operation } of operations) {
      if (!operation.operationId || operation.operationId.trim().length === 0)
        throw new Error(`${method.toUpperCase()} ${routePath} is missing operationId`);

      if (operationIds.has(operation.operationId))
        throw new Error(`${method.toUpperCase()} ${routePath} duplicates operationId '${operation.operationId}'`);

      operationIds.add(operation.operationId);

      if (!operation.responses || Object.keys(operation.responses).length === 0)
        throw new Error(`${method.toUpperCase()} ${routePath} does not declare any responses`);
    }
  });

  it("should only use declared security schemes", () => {
    const declaredSecuritySchemes = new Set<string>([
      ...Object.keys(openApi.components?.securitySchemes ?? {}),
      ...Object.keys(openApi.securityDefinitions ?? {}),
    ]);

    for (const { path: routePath, method, operation } of operations) {
      if (!operation.security || operation.security.length === 0) continue;

      for (const requirement of operation.security)
        for (const schemeName of Object.keys(requirement))
          if (!declaredSecuritySchemes.has(schemeName))
            throw new Error(`${method.toUpperCase()} ${routePath} uses undeclared security scheme '${schemeName}'`);
    }
  });

  it("should declare all templated path parameters in operation parameters", () => {
    const pathParamRegex = /\{([^}]+)\}/g;

    for (const { path: routePath, method, operation, pathLevelParameters } of operations) {
      const templatedParams = [...routePath.matchAll(pathParamRegex)].map((match) => match[1]);
      if (templatedParams.length === 0) continue;

      const operationPathParams = operation.parameters?.filter((parameter) => parameter.in === "path") ?? [];
      const pathLevelPathParams = pathLevelParameters.filter((parameter) => parameter.in === "path");
      const declaredPathParams = new Set(
        [...operationPathParams, ...pathLevelPathParams].map((parameter) => parameter.name),
      );

      for (const templatedParam of templatedParams)
        if (!declaredPathParams.has(templatedParam))
          throw new Error(`${method.toUpperCase()} ${routePath} is missing path parameter '${templatedParam}'`);
    }
  });

  it("should resolve every local $ref pointer", () => {
    const refs = new Set<string>();
    collectRefs(openApi, refs);

    for (const ref of refs) {
      if (!ref.startsWith("#/")) continue;
      expect(resolveLocalRef(openApi, ref)).toBeDefined();
    }
  });
});
