import bcrypt from "bcrypt";
import md5 from "md5";

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 12);
}

export function isLegacyPasswordHash(value: string): boolean {
  return /^[a-f0-9]{32}$/i.test(value);
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (isLegacyPasswordHash(storedHash)) return md5(password) === storedHash;

  try {
    return bcrypt.compareSync(password, storedHash);
  } catch {
    return false;
  }
}
