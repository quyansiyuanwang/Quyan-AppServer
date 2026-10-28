import { describe, expect, it } from "vitest";
import { buildRelayUpstreamHeaders } from "@/services/relay/utils/relay-upstream-headers.util";
import type { RelayRequestFormat } from "@quyan/shared";

const incoming = {
  "Content-Type": "application/json",
  Accept: "text/event-stream",
  "Accept-Encoding": "gzip",
  "User-Agent": "test-sdk",
  "X-Request-Id": "request-fixture",
  "X-Client-Request-Id": "client-fixture",
  "Idempotency-Key": "idempotency-fixture",
  "OpenAI-Organization": "org-fixture",
  "OpenAI-Project": "proj-fixture",
  "OpenAI-Beta": "responses=fixture",
  "Anthropic-Version": "2099-01-01",
  "Anthropic-Beta": ["beta-one", "beta-two"],
  "X-Goog-Api-Client": "test-sdk/1.0",
  Authorization: "Bearer caller-fixture",
  "X-Api-Key": "caller-fixture",
  "X-Goog-Api-Key": "caller-fixture",
  "Api-Key": "caller-fixture",
  Cookie: "session=fixture",
  "Proxy-Authorization": "Basic fixture",
  Host: "caller.invalid",
  "Content-Length": "999",
  "Transfer-Encoding": "chunked",
  "Keep-Alive": "timeout=5",
  Upgrade: "websocket",
  TE: "trailers",
  Trailer: "x-checksum",
  Forwarded: "for=192.0.2.1",
  "X-Forwarded-For": "192.0.2.1",
  "X-Internal-Control": "fixture",
  "X-Stainless-Retry-Count": "2",
};

describe("relay upstream request headers", () => {
  it.each<RelayRequestFormat>(["openai", "openai-chat-completions", "openai-responses", "anthropic", "gemini"])(
    "preserves OpenCode sessions and configured SDK headers for %s",
    (format) => {
      const result = buildRelayUpstreamHeaders(
        {
          "X-Opencode-Session": "session-fixture",
          "X-Stainless-Retry-Count": "2",
          "X-Unlisted": "drop",
        },
        format,
        "provider-fixture",
        [" X-Stainless-Retry-Count ", "x-stainless-retry-count"],
      );
      expect(result).toMatchObject({ "x-opencode-session": "session-fixture", "x-stainless-retry-count": "2" });
      expect(result).not.toHaveProperty("x-unlisted");
    },
  );

  it("never forwards configured Connection options or newline-injected values", () => {
    const result = buildRelayUpstreamHeaders(
      {
        Connection: "x-sdk-custom, x-opencode-session",
        "X-Sdk-Custom": "drop",
        "X-Opencode-Session": "drop",
        "X-Sdk-Invalid": "bad\r\nInjected: yes",
        "X-Sdk-Array": ["ok", "bad\nvalue"],
      },
      "openai",
      "provider-fixture",
      ["x-sdk-custom", "x-sdk-invalid", "x-sdk-array"],
    );
    expect(result).toEqual({ Authorization: "Bearer provider-fixture" });
  });

  it("fails closed for invalid stored allowlists without forwarding caller credentials", () => {
    for (const config of [
      ["authorization"],
      ["cookie"],
      ["x-internal-control"],
      ["*"],
      "x-sdk-custom",
      ["x-sdk-custom", "host"],
    ]) {
      const result = buildRelayUpstreamHeaders(
        { ...incoming, "X-Sdk-Custom": "drop" },
        "openai",
        "provider-fixture",
        config,
      );
      expect(result).not.toHaveProperty("x-sdk-custom");
      expect(result).not.toHaveProperty("cookie");
      expect(result).not.toHaveProperty("authorization");
      expect(result.Authorization).toBe("Bearer provider-fixture");
    }
  });

  it.each<RelayRequestFormat>(["openai", "openai-chat-completions", "openai-responses"])(
    "preserves OpenAI protocol and common headers for %s without caller secrets or routing headers",
    (format) => {
      expect(buildRelayUpstreamHeaders(incoming, format, "provider-fixture")).toEqual({
        "content-type": "application/json",
        accept: "text/event-stream",
        "accept-encoding": "gzip",
        "user-agent": "test-sdk",
        "x-request-id": "request-fixture",
        "x-client-request-id": "client-fixture",
        "idempotency-key": "idempotency-fixture",
        "openai-organization": "org-fixture",
        "openai-project": "proj-fixture",
        "openai-beta": "responses=fixture",
        Authorization: "Bearer provider-fixture",
      });
    },
  );

  it("preserves caller Anthropic version and beta instead of replacing the requested version", () => {
    const result = buildRelayUpstreamHeaders(incoming, "anthropic", "provider-fixture");
    expect(result).toMatchObject({
      "x-api-key": "provider-fixture",
      "anthropic-version": "2099-01-01",
      "anthropic-beta": ["beta-one", "beta-two"],
    });
    expect(result["anthropic-beta"]).not.toBe(incoming["Anthropic-Beta"]);
    expect(result).not.toHaveProperty("Authorization");
    expect(result).not.toHaveProperty("openai-beta");
    expect(result).not.toHaveProperty("x-goog-api-client");
  });

  it("provides an Anthropic version only when the caller did not provide one", () => {
    expect(buildRelayUpstreamHeaders({}, "anthropic", "provider-fixture")).toEqual({
      "x-api-key": "provider-fixture",
      "anthropic-version": "2023-06-01",
    });
  });

  it("uses only the selected Gemini provider credential and its protocol headers", () => {
    const result = buildRelayUpstreamHeaders(incoming, "gemini", "provider-fixture");
    expect(result).toMatchObject({
      "x-goog-api-key": "provider-fixture",
      "x-goog-api-client": "test-sdk/1.0",
    });
    expect(result).not.toHaveProperty("Authorization");
    expect(result).not.toHaveProperty("x-api-key");
    expect(result).not.toHaveProperty("anthropic-version");
    expect(result).not.toHaveProperty("openai-project");
    expect(result).not.toHaveProperty("cookie");
  });

  it.each([{ connection: "keep-alive, OpenAI-Beta, x-request-id" }, { connection: ["OpenAI-Beta", "x-request-id"] }])(
    "removes Connection-nominated headers even if allowlisted (%s)",
    ({ connection }) => {
      const result = buildRelayUpstreamHeaders({ ...incoming, Connection: connection }, "openai", "provider-fixture");
      expect(result).not.toHaveProperty("openai-beta");
      expect(result).not.toHaveProperty("x-request-id");
      expect(result).not.toHaveProperty("connection");
      expect(result["openai-project"]).toBe("proj-fixture");
    },
  );

  it("never lets connection options suppress server-generated authentication", () => {
    const result = buildRelayUpstreamHeaders(
      { Connection: "x-api-key, anthropic-version" },
      "anthropic",
      "provider-fixture",
    );
    expect(result).toEqual({ "x-api-key": "provider-fixture", "anthropic-version": "2023-06-01" });
  });

  it("ignores malformed or empty header values and does not mutate incoming headers", () => {
    const source = { ...incoming, "Anthropic-Version": " ", Accept: {}, "X-Request-Id": [1], "Anthropic-Beta": [] };
    const original = structuredClone(source);
    const result = buildRelayUpstreamHeaders(source, "anthropic", "provider-fixture");
    expect(result["anthropic-version"]).toBe("2023-06-01");
    expect(result).not.toHaveProperty("accept");
    expect(result).not.toHaveProperty("x-request-id");
    expect(result).not.toHaveProperty("anthropic-beta");
    expect(source).toEqual(original);
  });
});
