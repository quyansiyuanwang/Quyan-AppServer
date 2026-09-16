import { z } from "zod";

export const encryptedPasswordCredentialSchema = z.object({
  algorithm: z.literal("RSA-OAEP-256"),
  keyId: z.string().trim().min(1).max(128),
  ciphertext: z.string().trim().min(1).max(4096),
});
