import { describe, expect, it } from "vitest";
import { PasswordEncryptionService } from "../../../src/services/auth/password-encryption.service";

const pemToArrayBuffer = (pem: string): ArrayBuffer => {
  const binary = Buffer.from(
    pem
      .replace(/-----BEGIN PUBLIC KEY-----/g, "")
      .replace(/-----END PUBLIC KEY-----/g, "")
      .replace(/\s+/g, ""),
    "base64",
  );
  return binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength) as ArrayBuffer;
};

const encryptPassword = async (password: string, publicKey: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "spki",
    pemToArrayBuffer(publicKey),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, new TextEncoder().encode(password));
  return Buffer.from(ciphertext).toString("base64");
};

describe("PasswordEncryptionService", () => {
  const service = PasswordEncryptionService.getInstance();

  it("decrypts a credential made with the advertised public key", async () => {
    const metadata = service.getPublicKey();
    const ciphertext = await encryptPassword("correct horse battery staple", metadata.publicKey);

    expect(
      service.decrypt({
        algorithm: "RSA-OAEP-256",
        keyId: metadata.keyId,
        ciphertext,
      }),
    ).toBe("correct horse battery staple");
  });

  it("rejects stale key ids without attempting decryption", () => {
    expect(() =>
      service.decrypt({
        algorithm: "RSA-OAEP-256",
        keyId: "stale-key",
        ciphertext: "invalid",
      }),
    ).toThrowError(expect.objectContaining({ code: 1048 }));
  });

  it("rejects malformed ciphertext as an invalid credential", () => {
    const metadata = service.getPublicKey();
    expect(() =>
      service.decrypt({
        algorithm: "RSA-OAEP-256",
        keyId: metadata.keyId,
        ciphertext: "not-a-ciphertext",
      }),
    ).toThrowError(expect.objectContaining({ code: 1002 }));
  });
});
