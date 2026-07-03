import { describe, expect, it } from "vitest";
import { setResponseMessage, skipResponseWrapper } from "@/util/response-wrapper";

describe("response-wrapper util", () => {
  it("marks request to skip response wrapper", () => {
    const req = { res: { locals: {} } } as any;

    skipResponseWrapper(req);

    expect(req.res.locals.skipResponseWrapper).toBe(true);
  });

  it("sets custom response message", () => {
    const req = { res: { locals: {} } } as any;

    setResponseMessage(req, "ok");

    expect(req.res.locals.responseMessage).toBe("ok");
  });

  it("does not throw when request has no response object", () => {
    expect(() => skipResponseWrapper({} as any)).not.toThrow();
    expect(() => setResponseMessage({} as any, "x")).not.toThrow();
  });
});
