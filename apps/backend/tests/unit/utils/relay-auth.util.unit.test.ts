import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { extractRelayToken } from "@/util/relay/relay-auth";

function request(headers: Record<string, unknown> = {}, query: Record<string, unknown> = {}): Request {
  return { headers, query } as unknown as Request;
}

describe("relay credential extraction", () => {
  it.each(["sk-rlt-fixture-A9", "rlt_fixture-A9"])("accepts canonical and legacy credentials: %s", (token) => {
    for (const scheme of ["Bearer", "bearer", "BEARER"]) {
      expect(extractRelayToken(request({ authorization: `${scheme} ${token}` }))).toBe(token);
    }
    expect(extractRelayToken(request({ authorization: `Bearer   ${token} ` }))).toBe(token);
    expect(extractRelayToken(request({ "x-api-key": token }))).toBe(token);
    expect(extractRelayToken(request({}, { token }))).toBe(token);
  });

  it.each([
    "",
    "sk-rlt-",
    "rlt_",
    "sk-ak-fixture",
    "sk-dpk-fixture",
    "sk-dk-fixture",
    "sk-ojqa-fixture",
    "sk-fixture",
    "sk-rlt-fixture_secret",
    "sk-rlt-fixture\n",
    "sk-rlt-fixture\0",
  ])("rejects invalid credentials from every source: %j", (token) => {
    expect(extractRelayToken(request({ authorization: `Bearer ${token}` }))).toBeNull();
    expect(extractRelayToken(request({ "x-api-key": token }))).toBeNull();
    expect(extractRelayToken(request({}, { token }))).toBeNull();
  });

  it.each([null, [], ["sk-rlt-fixture"], ["sk-rlt-one", "sk-rlt-two"], {}, { value: "sk-rlt-fixture" }, 123])(
    "rejects non-string input without throwing: %j",
    (value) => {
      expect(extractRelayToken(request({ authorization: value }))).toBeNull();
      expect(extractRelayToken(request({ "x-api-key": value }))).toBeNull();
      expect(extractRelayToken(request({}, { token: value }))).toBeNull();
    },
  );

  it.each([
    "",
    "sk-rlt-fixture",
    "Basic sk-rlt-fixture",
    "prefixBearer sk-rlt-fixture",
    "Bearer\tsk-rlt-fixture",
    "Bearer sk-rlt-fixture\r\n",
  ])("rejects malformed Authorization without falling back: %j", (authorization) => {
    expect(
      extractRelayToken(request({ authorization, "x-api-key": "sk-rlt-fallback" }, { token: "sk-rlt-query" })),
    ).toBeNull();
  });

  it("preserves source precedence and rejects an invalid API key instead of using the query", () => {
    expect(
      extractRelayToken(
        request({ authorization: "Bearer sk-rlt-header", "x-api-key": "sk-rlt-api" }, { token: "sk-rlt-query" }),
      ),
    ).toBe("sk-rlt-header");
    expect(extractRelayToken(request({ "x-api-key": "sk-rlt-api" }, { token: "sk-rlt-query" }))).toBe("sk-rlt-api");
    expect(extractRelayToken(request({ "x-api-key": "" }, { token: "sk-rlt-query" }))).toBeNull();
    expect(extractRelayToken(request())).toBeNull();
  });
});
