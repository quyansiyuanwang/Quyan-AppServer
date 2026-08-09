import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { ValidateError } from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import { localeMiddleware } from "@/middleware/locale";
import { responseWrapperMiddleware } from "@/middleware/response-wrapper";
import { exceptionMiddleware } from "@/middleware/exception";
import { CustomCode } from "@/constant/custom-code";
import { BadRequestError, TooManyRequestsError } from "@/util/errors";
import { DEFAULT_BACKEND_LOCALE, translateMessage } from "@/locales";

function createApp() {
  const app = express();
  app.use(localeMiddleware);

  app.use((req, res, next) => {
    if (req.path !== "/timeout-like") {
      next();
      return;
    }

    res.status(HttpStatusCode.GatewayTimeout).json({
      code: HttpStatusCode.GatewayTimeout,
      message: translateMessage("errors.gatewayTimeout", req.locale ?? DEFAULT_BACKEND_LOCALE),
    });
  });

  app.use(responseWrapperMiddleware);

  app.get("/success", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/resource-with-message", (_req, res) => {
    res.json({ id: "error-group-1", message: "A captured application error" });
  });

  app.get("/rate-limit", () => {
    throw new TooManyRequestsError();
  });

  app.get("/pool-members-required", () => {
    throw new BadRequestError("pooled channel must contain at least one member", undefined, {
      messageKey: "relay.poolMembersRequired",
    });
  });

  app.get("/validate", () => {
    throw new ValidateError(
      {
        name: {
          message: "name is required",
          value: undefined,
        },
      },
      "Validation failed",
    );
  });

  app.use((_req, res) => {
    res.status(HttpStatusCode.NotFound).json({ code: CustomCode.NOT_FOUND, message: "Not Found" });
  });

  app.use(exceptionMiddleware);

  return app;
}

describe("backend locale-aware response messages", () => {
  it("localizes wrapped success messages via X-Locale", async () => {
    const app = createApp();

    await request(app)
      .get("/success")
      .set("X-Locale", "en")
      .expect(200)
      .expect(({ body, headers }) => {
        expect(headers["x-locale"]).toBe("en");
        expect(body).toMatchObject({
          code: CustomCode.OK,
          message: "Success",
          data: { ok: true },
        });
      });

    await request(app)
      .get("/success")
      .expect(200)
      .expect(({ body, headers }) => {
        expect(headers["x-locale"]).toBe("en");
        expect(body.message).toBe("Success");
      });

    await request(app)
      .get("/success")
      .set("X-Locale", "emoji")
      .expect(200)
      .expect(({ body, headers }) => {
        expect(headers["x-locale"]).toBe("en");
        expect(body.message).toBe("Success");
      });
  });

  it("preserves a domain object's message in response data", async () => {
    const app = createApp();

    await request(app)
      .get("/resource-with-message")
      .set("X-Locale", "en")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: CustomCode.OK,
          message: "Success",
          data: { id: "error-group-1", message: "A captured application error" },
        });
      });
  });

  it("resolves locale before timeout-like handlers", async () => {
    const app = createApp();

    await request(app)
      .get("/timeout-like")
      .set("X-Locale", "zh-CN")
      .expect(HttpStatusCode.GatewayTimeout)
      .expect(({ body, headers }) => {
        expect(headers["x-locale"]).toBe("zh-CN");
        expect(body.message).toBe("网关超时");
      });
  });

  it("localizes ApiError messages by custom code mapping", async () => {
    const app = createApp();

    await request(app)
      .get("/rate-limit")
      .set("X-Locale", "en")
      .expect(429)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: CustomCode.TOO_MANY_REQUESTS,
          message: "Too many requests",
        });
      });
  });

  it("localizes pooled validation errors by message key", async () => {
    const app = createApp();

    await request(app)
      .get("/pool-members-required")
      .set("X-Locale", "en")
      .expect(400)
      .expect(({ body, headers }) => {
        expect(headers["x-locale"]).toBe("en");
        expect(body.message).toBe("A pooled channel must contain at least one member channel");
      });

    await request(app)
      .get("/pool-members-required")
      .set("X-Locale", "zh-CN")
      .expect(400)
      .expect(({ body, headers }) => {
        expect(headers["x-locale"]).toBe("zh-CN");
        expect(body.message).toBe("混池渠道至少需要一个成员渠道");
      });
  });

  it("localizes validation and not-found messages", async () => {
    const app = createApp();

    await request(app)
      .get("/validate")
      .set("X-Locale", "en")
      .expect(422)
      .expect(({ body }) => {
        expect(body.message).toBe("Validation failed");
        expect(body.error).toBe("Request validation failed");
      });

    await request(app)
      .get("/missing")
      .set("X-Locale", "en")
      .expect(404)
      .expect(({ body }) => {
        expect(body.message).toBe("Not Found");
      });
  });
});
