import type { Request } from "express";

/**
 * 提取客户端真实 IP 地址
 * 考虑代理和负载均衡器的情况
 */
export function extractClientIp(req: Request): string {
  // Express resolves forwarding headers only when the configured proxy trust
  // boundary allows it. Never parse these headers directly here.
  return normalizeIp(req.ip || req.socket.remoteAddress || "unknown");
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
