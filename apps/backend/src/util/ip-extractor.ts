import type { Request } from "express";

/**
 * 提取客户端真实 IP 地址
 * 考虑代理和负载均衡器的情况
 */
export function extractClientIp(req: Request): string {
  // 优先级顺序：
  // 1. X-Forwarded-For（取第一个 IP）
  // 2. X-Real-IP
  // 3. req.ip（Express 默认）

  const xForwardedFor = req.headers["x-forwarded-for"];
  if (xForwardedFor) {
    const ips = (xForwardedFor as string).split(",");
    return normalizeIp(ips[0].trim());
  }

  const xRealIp = req.headers["x-real-ip"];
  if (xRealIp) return normalizeIp(xRealIp as string);

  let ip = req.ip || req.socket.remoteAddress || "unknown";
  return normalizeIp(ip);
}

/**
 * 标准化 IP 地址格式
 * 将 IPv6 映射的 IPv4 地址转换为标准 IPv4 格式
 */
export function normalizeIp(ip: string): string {
  // 移除 IPv6 映射的 IPv4 地址前缀 ::ffff:
  if (ip.startsWith("::ffff:")) return ip.substring(7);

  // 标准化 IPv6 localhost 为 IPv4
  if (ip === "::1") return "127.0.0.1";

  return ip;
}
