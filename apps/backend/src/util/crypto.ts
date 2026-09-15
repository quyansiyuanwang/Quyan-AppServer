import bcrypt from "bcrypt";
import md5 from "md5";

export interface PasswordVerificationResult {
  valid: boolean;
  needsRehash: boolean;
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 12);
}

export function isLegacyPasswordHash(value: string): boolean {
  return /^[a-f0-9]{32}$/i.test(value);
}

export function verifyPassword(password: string, storedHash: string): boolean {
  return verifyPasswordCompatibility(password, storedHash).valid;
}

/**
 * Accept both the new bcrypt(raw password) format and the two historical
 * formats produced by older clients: bcrypt(md5(password)) and md5(password).
 */
export function verifyPasswordCompatibility(password: string, storedHash: string): PasswordVerificationResult {
  if (isLegacyPasswordHash(storedHash)) {
    // New clients send the raw password; old clients sent md5(password).
    const valid = md5(password) === storedHash || password === storedHash;
    return { valid, needsRehash: valid };
  }

  try {
    if (bcrypt.compareSync(password, storedHash)) return { valid: true, needsRehash: false };
    if (bcrypt.compareSync(md5(password), storedHash)) return { valid: true, needsRehash: true };
    return { valid: false, needsRehash: false };
  } catch {
    return { valid: false, needsRehash: false };
  }
}
