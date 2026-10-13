import { isIP } from "node:net";
/** A validated address has one authorization identity; IPv6 colons become underscores in the ARN segment. */
export function canonicalIpAddressIdentifier(input: unknown): string | undefined {
  if (typeof input !== "string" || input.length > 45 || !/^[0-9a-fA-F:.]+$/.test(input) || !isIP(input))
    return undefined;
  if (isIP(input) === 4) return input;
  const address = new URL("http://[" + input + "]").hostname.slice(1, -1);
  if (address === "::1") return "127.0.0.1";
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(address);
  if (mapped) {
    const high = parseInt(mapped[1]!, 16),
      low = parseInt(mapped[2]!, 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join(".");
  }
  return address.replace(/:/g, "_");
}
