import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { buildSwaggerPageHtml } from "@/util/swagger-page-template";

vi.mock("@/constant/file-path", async () => {
  const { fileURLToPath } = await import("node:url");
  const source = (file: string) => fileURLToPath(new URL(`../../../${file}`, import.meta.url));
  return {
    SWAGGER_CUSTOM_HTML_PATH: source("public/assets/swagger.html"),
    SWAGGER_HTML_TEMPLATE_PATH: source("public/assets/swagger.template.html"),
  };
});

vi.mock("@/util/swagger-spec-loader", () => ({
  loadSwaggerDocument: () => ({
    paths: {
      "/v2/relay/tokens/current/quota-summary": {
        get: { operationId: "RelayV2ControllerGetCurrentTokenQuotaSummary" },
      },
    },
  }),
}));

describe("Swagger relay quota helper", () => {
  it.each(["sk-rlt-quota-fixture", "rlt_quota-fixture"])(
    "uses the Relay authorization and generated V2 path",
    (token) => {
      const html = buildSwaggerPageHtml("Test documentation");
      const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].find((match) =>
        match[1]?.includes("function fetchQuota"),
      )?.[1];
      expect(script).toBeDefined();
      const status = {};
      const result = { style: {} };
      let click: (() => void) | undefined;
      let mount: (() => void) | undefined;
      const button = {
        addEventListener: (_event: string, handler: () => void) => {
          click = handler;
        },
      };
      const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: {} }) });
      const panel = {
        querySelector: (selector: string) =>
          selector.endsWith("__button") ? button : selector.endsWith("__status") ? status : result,
      };
      const window = {
        onload: undefined as (() => void) | undefined,
        setInterval: (handler: () => void) => {
          mount = handler;
        },
        clearInterval: vi.fn(),
      };
      const swaggerUi = {
        authSelectors: {
          authorized: () => ({
            toJS: () => ({
              jwt: { value: "Bearer session-fixture" },
              "relay-token": { value: `Bearer ${token}` },
            }),
          }),
        },
      };
      runInNewContext(script!, {
        fetch,
        window,
        SwaggerUIBundle: Object.assign(() => swaggerUi, { presets: {}, plugins: {} }),
        SwaggerUIStandalonePreset: {},
        document: {
          createElement: () => ({ ...panel }),
          getElementById: () => null,
          querySelector: () => ({ parentNode: { insertBefore: vi.fn() } }),
        },
      });
      window.onload?.();
      mount?.();
      click?.();
      expect(fetch).toHaveBeenCalledExactlyOnceWith("/v2/relay/tokens/current/quota-summary", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
    },
  );
});
