import { describe, expect, it } from "vitest";
import express from "express";
import type { IncomingMessage } from "node:http";
import { terminalUpgradeConditionContext } from "@/modules/remote-terminal/gateway/connection-context";
const request = (headers: Record<string, string>, encrypted = false) =>
  ({ headers, socket: { remoteAddress: "::ffff:192.0.2.10", encrypted } }) as unknown as IncomingMessage;
describe("terminal upgrade trusted transport", () => {
  it("ignores forwarding headers without a proxy trust boundary", () => {
    const context = terminalUpgradeConditionContext(
      request({ "x-forwarded-for": "198.51.100.10", "x-forwarded-proto": "https" }),
    );
    expect(context).toEqual({ "acs:SourceIp": "192.0.2.10", "acs:SecureTransport": false });
  });
  it("uses the same Express getters when the application trusts no proxies", () => {
    const app = express();
    app.set("trust proxy", 0);
    expect(
      terminalUpgradeConditionContext(
        request({ "x-forwarded-for": "198.51.100.10", "x-forwarded-proto": "https", "user-agent": "fixture-agent" }),
        app,
      ),
    ).toEqual({ "acs:SourceIp": "192.0.2.10", "acs:SecureTransport": false, "acs:UserAgent": "fixture-agent" });
  });
  it("uses the actual configured trust hops for a proxied connection", () => {
    const app = express();
    app.set("trust proxy", 1);
    expect(
      terminalUpgradeConditionContext(
        request({ "x-forwarded-for": "203.0.113.20, 198.51.100.10", "x-forwarded-proto": "https" }),
        app,
      ),
    ).toEqual({ "acs:SourceIp": "198.51.100.10", "acs:SecureTransport": true });
  });
  it("uses direct TLS and never copies authorization headers or invalid user agents", () => {
    const app = express();
    app.set("trust proxy", 0);
    expect(
      terminalUpgradeConditionContext(
        request({ authorization: "fixture-secret", "user-agent": "bad\nagent" }, true),
        app,
      ),
    ).toEqual({ "acs:SourceIp": "192.0.2.10", "acs:SecureTransport": true });
  });
});
