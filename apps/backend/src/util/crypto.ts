import md5 from "md5";

export function hashPassword(password: string): string {
  return md5(password);
}
