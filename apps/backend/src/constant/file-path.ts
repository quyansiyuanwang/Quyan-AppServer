import { EnvSpace } from "@/config/env";
import fs from "fs";
import path from "path";

function resolveRuntimePath(...candidatePaths: string[]): string {
  for (const candidatePath of candidatePaths) {
    const absolutePath = path.join(EnvSpace.cwd, candidatePath);
    if (fs.existsSync(absolutePath)) return absolutePath;
  }

  return path.join(EnvSpace.cwd, candidatePaths[0] || "");
}

function resolveSwaggerUiDistPath(): string {
  try {
    return path.dirname(require.resolve("swagger-ui-dist"));
  } catch {
    return "";
  }
}

export const SWAGGER_PATH = resolveRuntimePath("dist/build/swagger.json", "src/build/swagger.json");
export const SWAGGER_CUSTOM_HTML_PATH = resolveRuntimePath(
  "dist/public/assets/swagger.html",
  "public/assets/swagger.html",
);
export const SWAGGER_HTML_TEMPLATE_PATH = resolveRuntimePath(
  "dist/public/assets/swagger.template.html",
  "public/assets/swagger.template.html",
);
export const SWAGGER_UI_DIST_PATH = resolveRuntimePath(
  "dist/public/vendor/swagger-ui",
  "public/vendor/swagger-ui",
  "node_modules/swagger-ui-dist",
  resolveSwaggerUiDistPath(),
);
