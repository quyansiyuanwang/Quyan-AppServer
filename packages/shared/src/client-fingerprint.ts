export const FINGERPRINT_PATTERN = /^[A-Za-z0-9._:-]{16,256}$/;

export const normalizeFingerprint = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!FINGERPRINT_PATTERN.test(normalized)) return undefined;
  return normalized;
};
