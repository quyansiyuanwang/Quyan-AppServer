import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { extractClientIp, normalizeIp } from "../../../src/util/ip-extractor";

const requestWith = (ip: string | undefined, remoteAddress: string | undefined, forwardedFor?: string): Request =>
  ({
    ip,
    socket: { remoteAddress },
    headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
  }) as unknown as Request;

describe("client IP extraction", () => {
  it("uses Express-resolved req.ip and does not parse forwarding headers itself", () => {
    const request = requestWith(undefined, "192.0.2.10", "198.51.100.5, 192.0.2.10");

    expect(extractClientIp(request)).toBe("192.0.2.10");
  });

  it("normalizes IPv6-mapped IPv4 and loopback addresses", () => {
    expect(normalizeIp("::ffff:203.0.113.42")).toBe("203.0.113.42");
    expect(normalizeIp("::1")).toBe("127.0.0.1");
    expect(extractClientIp(requestWith("::ffff:203.0.113.42", "192.0.2.10"))).toBe("203.0.113.42");
  });
});