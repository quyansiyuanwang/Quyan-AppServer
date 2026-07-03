import express from "express";
import { HttpStatusCode } from "axios";
import fs from "fs-extra";
import { swaggerAuthMiddleware } from "@/middleware/auth/swagger_auth";
import { SWAGGER_PATH } from "@/constant/file-path";
import { registerSwaggerAssetRoutes } from "./swagger-asset-routes";
import { buildSwaggerPageHtml } from "./swagger-page-template";

export function registerSwaggerUi(app: express.Express): void {
  registerSwaggerAssetRoutes(app);

  if (!fs.existsSync(SWAGGER_PATH)) return;

  const sendSwaggerPage = (_req: express.Request, res: express.Response) => {
    res.status(HttpStatusCode.Ok).type("html").send(buildSwaggerPageHtml("Backend API Documentation"));
  };

  app.get("/docs", swaggerAuthMiddleware, sendSwaggerPage);
  app.get("/docs/", swaggerAuthMiddleware, sendSwaggerPage);
}
