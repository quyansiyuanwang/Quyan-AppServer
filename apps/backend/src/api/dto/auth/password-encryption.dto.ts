/** Supported client-side password encryption algorithms. */
export type PasswordEncryptionAlgorithm = "RSA-OAEP-256";

/** Encrypted password credential accepted by password-bearing endpoints. */
export interface EncryptedPasswordCredentialDto {
  algorithm: PasswordEncryptionAlgorithm;
  keyId: string;
  ciphertext: string;
}

/** Public key metadata used to encrypt a password before submission. */
export interface PasswordEncryptionKeyResponse {
  algorithm: PasswordEncryptionAlgorithm;
  keyId: string;
  publicKey: string;
}
