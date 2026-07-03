import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "rtm-t.";
const TTL_SECONDS = 900;

export function isInstallToken(token: string): boolean {
  return token.startsWith(PREFIX);
}

export function issueInstallToken(entitlementId: string, secret: string): { token: string; expiresAt: string } {
  const iat = Math.floor(Date.now() / 1000);
  const idB64 = Buffer.from(entitlementId).toString("base64url");
  const iatB64 = Buffer.from(String(iat)).toString("base64url");
  const hmac = createHmac("sha256", secret).update(`${entitlementId}:${iat}`).digest("hex");
  return {
    token: `${PREFIX}${idB64}.${iatB64}.${hmac}`,
    expiresAt: new Date((iat + TTL_SECONDS) * 1000).toISOString(),
  };
}

export function verifyInstallToken(token: string, secret: string): { entitlementId: string } | null {
  if (!token.startsWith(PREFIX)) return null;
  const parts = token.slice(PREFIX.length).split(".");
  if (parts.length !== 3) return null;
  const [idB64, iatB64, providedHmac] = parts;
  try {
    const entitlementId = Buffer.from(idB64, "base64url").toString();
    const iat = parseInt(Buffer.from(iatB64, "base64url").toString(), 10);
    if (!Number.isFinite(iat)) return null;
    if (Math.abs(Math.floor(Date.now() / 1000) - iat) > TTL_SECONDS) return null;
    const expected = createHmac("sha256", secret).update(`${entitlementId}:${iat}`).digest("hex");
    if (providedHmac.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(providedHmac, "hex"), Buffer.from(expected, "hex"))) return null;
    return { entitlementId };
  } catch {
    return null;
  }
}
