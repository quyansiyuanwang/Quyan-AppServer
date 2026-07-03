/**
 * Mask sensitive information in data before sending to frontend
 */

const SENSITIVE_KEYS = [
  "password",
  "token",
  "access_token",
  "refresh_token",
  "accessToken",
  "refreshToken",
  "secret",
  "apiKey",
  "api_key",
  "authorization",
  "apikey",
];

const JWT_PATTERN = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/;

export function maskSensitiveData(obj: any): any {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    if (JWT_PATTERN.test(obj)) return "***TOKEN_MASKED***";
    return obj;
  }

  if (Array.isArray(obj)) return obj.map(maskSensitiveData);

  if (typeof obj === "object") {
    const masked: any = {};
    for (const key in obj)
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const lowerKey = key.toLowerCase();
        if (SENSITIVE_KEYS.some((sensitive) => lowerKey.includes(sensitive))) masked[key] = "***MASKED***";
        else masked[key] = maskSensitiveData(obj[key]);
      }

    return masked;
  }

  return obj;
}
