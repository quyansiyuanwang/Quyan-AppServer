import { describe, expect, it } from "vitest";
import { setResponseMessageKey, skipResponseWrapper } from "@/util/response-wrapper";

describe("response-wrapper util", () => {
  it("marks request to skip response wrapper", () => {
    const req = { res: { locals: {} } } as any;

    skipResponseWrapper(req);

    expect(req.res.locals.skipResponseWrapper).toBe(true);
  });

  it("sets a custom response message descriptor", () => {
    const req = { res: { locals: {} } } as any;

    setResponseMessageKey(req, "common.success");

    expect(req.res.locals.responseMessageDescriptor).toMatchObject({ key: "common.success" });
  });

  it("does not throw when request has no response object", () => {
    expect(() => skipResponseWrapper({} as any)).not.toThrow();
    expect(() => setResponseMessageKey({} as any, "common.success")).not.toThrow();
  });
});
