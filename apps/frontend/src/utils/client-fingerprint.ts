import StorageKey from '@/constant/storagekey';
import { normalizeFingerprint } from '@appserver/shared';

const randomHex = (bytes: number): string => {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const generateFingerprint = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    const uuid = globalThis.crypto.randomUUID().replace(/-/g, '');
    const normalized = normalizeFingerprint(uuid);
    if (normalized) return normalized;
  }

  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const candidate = randomHex(16);
    const normalized = normalizeFingerprint(candidate);
    if (normalized) return normalized;
  }

  const fallback = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 18)}`;
  return normalizeFingerprint(fallback) || 'client-fingerprint-fallback-id';
};

export const getOrCreateClientFingerprint = (): string | undefined => {
  if (typeof window === 'undefined') return undefined;

  const storageKey = StorageKey.Util.CLIENT_FINGERPRINT;

  try {
    const existing = normalizeFingerprint(localStorage.getItem(storageKey));
    if (existing) return existing;

    const generated = generateFingerprint();
    localStorage.setItem(storageKey, generated);
    return generated;
  } catch {
    return normalizeFingerprint(generateFingerprint());
  }
};
