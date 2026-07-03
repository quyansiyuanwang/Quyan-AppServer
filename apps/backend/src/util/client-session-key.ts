const CLIENT_SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export const normalizeFingerprint = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!CLIENT_SESSION_ID_PATTERN.test(normalized)) return undefined;
  return normalized;
};
