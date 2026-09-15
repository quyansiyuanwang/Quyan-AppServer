import { constants, privateDecrypt } from "node:crypto";
import { env } from "@/config/env";
import { BadRequestError } from "@/util/errors";
import { CustomCode } from "@/constant/custom-code";
import type {
  EncryptedPasswordCredentialDto,
  PasswordEncryptionKeyResponse,
} from "@/api/dto/auth/password-encryption.dto";

const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 50;

export class PasswordEncryptionService {
  private static instance: PasswordEncryptionService | null = null;

  private constructor() {}

  static getInstance(): PasswordEncryptionService {
    if (!this.instance) this.instance = new PasswordEncryptionService();
    return this.instance;
  }

  getPublicKey(): PasswordEncryptionKeyResponse {
    const { algorithm, keyId, publicKey } = env.auth.passwordEncryption;
    return { algorithm, keyId, publicKey };
  }

  decrypt(credential: EncryptedPasswordCredentialDto): string {
    if (credential.algorithm !== "RSA-OAEP-256")
      throw new BadRequestError("不支持的密码加密算法", CustomCode.VALIDATION_FAILED, {
        messageKey: "errors.passwordEncryptionInvalid",
      });

    if (credential.keyId !== env.auth.passwordEncryption.keyId)
      throw new BadRequestError("密码加密公钥已失效，请刷新后重试", CustomCode.PASSWORD_ENCRYPTION_KEY_INVALID, {
        messageKey: "errors.passwordEncryptionKeyInvalid",
      });

    let password: string;
    try {
      password = privateDecrypt(
        {
          key: env.auth.passwordEncryption.privateKey,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256",
        },
        Buffer.from(credential.ciphertext, "base64"),
      ).toString("utf8");
    } catch {
      throw new BadRequestError("密码凭据无效", CustomCode.VALIDATION_FAILED, {
        messageKey: "errors.passwordEncryptionInvalid",
      });
    }

    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH)
      throw new BadRequestError("密码长度必须为 6 到 50 个字符", CustomCode.VALIDATION_FAILED, {
        messageKey: "errors.passwordLengthInvalid",
      });

    return password;
  }

  resolvePassword(
    legacyPassword: string | undefined,
    credential: EncryptedPasswordCredentialDto | undefined,
    options: { required?: boolean } = {},
  ): string | undefined {
    if (legacyPassword !== undefined && credential !== undefined)
      throw new BadRequestError("不能同时提交密码和加密密码凭据", CustomCode.VALIDATION_FAILED, {
        messageKey: "errors.passwordCredentialConflict",
      });

    if (credential) return this.decrypt(credential);
    if (legacyPassword !== undefined) return legacyPassword;
    if (options.required)
      throw new BadRequestError("缺少密码", CustomCode.VALIDATION_FAILED, {
        messageKey: "errors.passwordRequired",
      });
    return undefined;
  }
}

export const passwordEncryptionService = PasswordEncryptionService.getInstance();
