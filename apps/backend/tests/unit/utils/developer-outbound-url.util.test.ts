import { describe, expect, it } from "vitest";
import { assertSafeOutboundUrl, isUnsafeOutboundAddress } from "@/util/developer-outbound-url";

describe("developer outbound URL guard", () => {
  it.each([
    "127.0.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "198.18.0.1",
    "198.51.100.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("rejects private, link-local, and reserved address %s", (address) => {
    expect(isUnsafeOutboundAddress(address)).toBe(true);
  });

  it("allows a public address and pins agents for the resolved address", async () => {
    const target = await assertSafeOutboundUrl("https://8.8.8.8/health");

    expect(target.url.toString()).toBe("https://8.8.8.8/health");
    expect(target.httpAgent).toBeDefined();
    expect(target.httpsAgent).toBeDefined();
    target.httpAgent.destroy();
    target.httpsAgent.destroy();
  });

  it("returns an address array when Node requests all DNS families", async () => {
    const target = await assertSafeOutboundUrl("https://8.8.8.8/health");
    const lookup = target.httpsAgent.options.lookup;
    expect(lookup).toBeTypeOf("function");

    const resolved = await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
      lookup!("example.test", { all: true }, (error, addresses) => {
        if (error) reject(error);
        else resolve(addresses as Array<{ address: string; family: number }>);
      });
    });

    expect(resolved).toEqual([{ address: "8.8.8.8", family: 4 }]);
    target.httpAgent.destroy();
    target.httpsAgent.destroy();
  });

  it("rejects unsupported protocols and URLs with embedded credentials", async () => {
    await expect(assertSafeOutboundUrl("file:///etc/passwd")).rejects.toThrow("仅允许 HTTP(S) URL");
    await expect(assertSafeOutboundUrl("https://user:pass@example.com")).rejects.toThrow("URL 不允许包含凭据");
  });
});
