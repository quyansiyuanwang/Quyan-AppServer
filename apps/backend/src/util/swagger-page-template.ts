import fs from "fs-extra";
import { SWAGGER_CUSTOM_HTML_PATH, SWAGGER_HTML_TEMPLATE_PATH } from "@/constant/file-path";
import { getLogger, LogCategory } from "@/util/logger";
import { loadSwaggerDocument } from "./swagger-spec-loader";

interface SwaggerPageAssets {
  customCss: string;
  customJsStr: string;
}

const logger = getLogger("SwaggerPageTemplate", LogCategory.APPLICATION);

function getSwaggerCustomAsset(): SwaggerPageAssets {
  if (!fs.existsSync(SWAGGER_CUSTOM_HTML_PATH)) {
    logger.warn("Swagger custom HTML asset not found", { path: SWAGGER_CUSTOM_HTML_PATH });
    return { customCss: "", customJsStr: "" };
  }

  const rawHtml = fs.readFileSync(SWAGGER_CUSTOM_HTML_PATH, "utf8");
  const styleBlocks = Array.from(
    rawHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi),
    (match) => match[1]?.trim() || "",
  )
    .filter(Boolean)
    .join("\n\n");
  const scriptBlocks = Array.from(
    rawHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi),
    (match) => match[1]?.trim() || "",
  )
    .filter(Boolean)
    .join("\n\n");

  return {
    customCss: styleBlocks,
    customJsStr: scriptBlocks,
  };
}

function escapeTemplateValue(value: string): string {
  return value.replace(/<\//g, "<\\/").replace(/</g, "\\u003c");
}

export function buildSwaggerPageHtml(title: string): string {
  if (!fs.existsSync(SWAGGER_HTML_TEMPLATE_PATH)) {
    logger.warn("Swagger HTML template not found", { path: SWAGGER_HTML_TEMPLATE_PATH });
    return "Swagger template not found";
  }

  const template = fs.readFileSync(SWAGGER_HTML_TEMPLATE_PATH, "utf8");
  const swaggerSpecJson = escapeTemplateValue(JSON.stringify(loadSwaggerDocument()));
  const customAssets = getSwaggerCustomAsset();

  return template
    .replaceAll("__SWAGGER_TITLE__", title)
    .replace("__SWAGGER_SPEC_JSON__", swaggerSpecJson)
    .replace("__SWAGGER_CUSTOM_CSS__", customAssets.customCss.trim())
    .replace("__SWAGGER_CUSTOM_JS__", customAssets.customJsStr.trim());
}
