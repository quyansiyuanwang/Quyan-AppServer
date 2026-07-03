import express from "express";
import { HttpStatusCode } from "axios";
import fs from "fs-extra";
import path from "path";
import { SWAGGER_UI_DIST_PATH } from "@/constant/file-path";
import { getLogger, LogCategory } from "@/util/logger";

type SwaggerUiAssetName = "swagger-ui.css" | "swagger-ui-bundle.js" | "swagger-ui-standalone-preset.js";

const logger = getLogger("SwaggerAssetRoutes", LogCategory.APPLICATION);

function getSwaggerPublicAssetPath(assetName: SwaggerUiAssetName): string {
  return path.join(SWAGGER_UI_DIST_PATH, assetName);
}

function sendPublicAsset(
  res: express.Response,
  filePath: string,
  contentType: "text/css" | "application/javascript; charset=utf-8",
): void {
  if (!fs.existsSync(filePath)) {
    logger.warn("Public asset not found", { filePath });
    res.status(HttpStatusCode.NotFound).send("Not Found");
    return;
  }

  res.type(contentType);
  res.sendFile(filePath);
}

export function registerSwaggerAssetRoutes(app: express.Express): void {
  app.get("/public-assets/swagger-ui/style", (_req, res) => {
    sendPublicAsset(res, getSwaggerPublicAssetPath("swagger-ui.css"), "text/css");
  });

  app.get("/public-assets/swagger-ui/bundle", (_req, res) => {
    sendPublicAsset(res, getSwaggerPublicAssetPath("swagger-ui-bundle.js"), "application/javascript; charset=utf-8");
  });

  app.get("/public-assets/swagger-ui/standalone-preset", (_req, res) => {
    sendPublicAsset(
      res,
      getSwaggerPublicAssetPath("swagger-ui-standalone-preset.js"),
      "application/javascript; charset=utf-8",
    );
  });
}
