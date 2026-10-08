import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Project } from "ts-morph";
import { collectIamRoutes } from "./route-inventory";
import { actionRouteCatalog } from "./action-route-catalog";
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const config = JSON.parse(fs.readFileSync(path.join(backendRoot, "tsoa.json"), "utf8")) as {
  controllerPathGlobs: string[];
};
const project = new Project({ skipAddingFilesFromTsConfig: true });
const sources = project.addSourceFilesAtPaths(config.controllerPathGlobs.map((glob) => path.join(backendRoot, glob)));
const catalog = actionRouteCatalog(collectIamRoutes(sources, backendRoot));
fs.writeFileSync(
  path.join(backendRoot, "src/build/iam-action-routes.ts"),
  "// Generated from Controller authorization metadata. Do not edit.\nexport const IAM_ACTION_ROUTES: Readonly<Record<string, readonly string[]>> = " +
    JSON.stringify(catalog, null, 2) +
    ";\n",
);
console.log("[iam] generated route links for " + Object.keys(catalog).length + " actions");
