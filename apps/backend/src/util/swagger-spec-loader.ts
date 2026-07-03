import fs from "fs-extra";
import { SWAGGER_PATH } from "@/constant/file-path";
import { generateUniqueOperationIdWithSet } from "@/util/operationIdGenerator";

interface OpenAPIOperation {
  operationId?: string;
  tags?: string[];
  summary?: string;
  description?: string;
  [key: string]: any;
}

interface OpenAPIPaths {
  [path: string]: {
    [method: string]: OpenAPIOperation;
  };
}

export interface SwaggerDocument {
  paths?: OpenAPIPaths;
  [key: string]: any;
}

const usedOperationIds = new Set<string>();

function generateOperationId(method: string, routePath: string): string {
  const httpMethod = method.toLowerCase();
  const segments = routePath.replace(/[{}]/g, "").split("/").filter(Boolean);

  const pathName = segments
    .map((segment) => {
      if (segment.toLowerCase() === "id") return "ById";

      const cleaned = segment.replace(/[^a-zA-Z0-9]/g, "");
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    })
    .join("");

  return generateUniqueOperationIdWithSet(`${httpMethod}${pathName}`, usedOperationIds);
}

export function loadSwaggerDocument(): SwaggerDocument {
  const swaggerDocument = fs.readJsonSync(SWAGGER_PATH) as SwaggerDocument;

  usedOperationIds.clear();

  if (swaggerDocument.paths)
    for (const [routePath, methods] of Object.entries(swaggerDocument.paths))
      for (const [httpMethod, operation] of Object.entries(methods)) {
        if (!operation || typeof operation !== "object" || Array.isArray(operation)) continue;

        const op = operation as OpenAPIOperation;

        if (!op.operationId) op.operationId = generateOperationId(httpMethod, routePath);
        else usedOperationIds.add(op.operationId);
      }

  return swaggerDocument;
}
