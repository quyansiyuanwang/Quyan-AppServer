import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { BadRequestError, ForbiddenError } from "@/util/errors";

export interface SafeOutboundUrl {
  url: URL;
  httpAgent: http.Agent;
  httpsAgent: https.Agent;
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255))
    return true;
  const [first, second] = octets;
  if (first === 0 || first === 10 || first === 127 || first >= 224) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && (second === 0 || second === 168)) return true;
  if (first === 198 && (second === 18 || second === 19 || second === 51)) return true;
  return first === 203 && second === 0 && octets[2] === 113;
}

function ipv4FromMappedIpv6(address: string): string | undefined {
  const normalized = address.toLowerCase();
  const embeddedIpv4 = normalized.match(/:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (embeddedIpv4 && normalized.startsWith("::ffff:")) return embeddedIpv4;

  const [head, tail = ""] = normalized.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  if ([...headParts, ...tailParts].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return undefined;
  const parts = [...headParts, ...Array(Math.max(0, 8 - headParts.length - tailParts.length)).fill("0"), ...tailParts];
  if (parts.length !== 8) return undefined;
  const values = parts.map((part) => Number.parseInt(part, 16));
  const isMapped = values.slice(0, 5).every((value) => value === 0) && values[5] === 0xffff;
  const isCompatible = values.slice(0, 6).every((value) => value === 0);
  if (!isMapped && !isCompatible) return undefined;
  return `${values[6] >> 8}.${values[6] & 0xff}.${values[7] >> 8}.${values[7] & 0xff}`;
}

export function isUnsafeOutboundAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family !== 6) return true;

  const normalized = address.toLowerCase();
  const mappedIpv4 = ipv4FromMappedIpv6(normalized);
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4);
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  if (normalized.startsWith("ff")) return true;
  return normalized.startsWith("2001:db8:");
}

function createPinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return ((_: string, __: unknown, callback: (error: Error | null, resolvedAddress: string, resolvedFamily: 4 | 6) => void) => {
    callback(null, address, family);
  }) as LookupFunction;
}

/**
 * Resolves and validates an HTTP(S) endpoint before pinning the resolved address
 * for the eventual request. This prevents private-network access and DNS rebinding.
 */
export async function assertSafeOutboundUrl(rawUrl: string): Promise<SafeOutboundUrl> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BadRequestError("URL 无效");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new BadRequestError("仅允许 HTTP(S) URL");
  if (url.username || url.password) throw new BadRequestError("URL 不允许包含凭据");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: Array<{ address: string; family: number }>;
  if (isIP(host)) {
    addresses = [{ address: host, family: isIP(host) }];
  } else {
    try {
      addresses = await lookup(host, { all: true, verbatim: true });
    } catch {
      throw new BadRequestError("无法解析目标主机");
    }
  }
  if (!addresses.length || addresses.some((entry) => isUnsafeOutboundAddress(entry.address)))
    throw new ForbiddenError("不允许访问内网地址");

  const resolved = addresses[0];
  const family = resolved.family === 6 ? 6 : 4;
  const pinnedLookup = createPinnedLookup(resolved.address, family);
  return {
    url,
    httpAgent: new http.Agent({ lookup: pinnedLookup }),
    httpsAgent: new https.Agent({ lookup: pinnedLookup }),
  };
}
