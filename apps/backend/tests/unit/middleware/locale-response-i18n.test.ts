import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { ValidateError } from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import { localeMiddleware } from "@/middleware/locale";
import { responseWrapperMiddleware } from "@/middleware/response-wrapper";
import { exceptionMiddleware } from "@/middleware/exception";
import { CustomCode } from "@/constant/custom-code";
import { TooManyRequestsError } from "@/util/errors";

function createApp() {
  const app = express();
  app.use(localeMiddleware);
  app.use(responseWrapperMiddleware);

  app.get("/success", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/rate-limit", () => {
    throw new TooManyRequestsError();
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
