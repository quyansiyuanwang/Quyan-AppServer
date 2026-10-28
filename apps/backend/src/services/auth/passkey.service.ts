import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";
import { UserRepository } from "@/store/users/user.repository";
import { PasskeyCredentialRepository } from "@/store/auth/passkey-credential.repository";
import type { UserStore } from "@/store/users/user.store";
import type { PasskeyCredentialStore } from "@/store/auth/passkey-credential.store";
import { RedisService } from "@/services/infrastructure/redis.service";
import { BadRequestError, NotFoundError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { PasskeyCredentialItem } from "@/api/dto/users/passkey.dto";
import { env } from "@/config/env";
import type { TypedRequest } from "@/types/express";
import { PasskeyIamService } from "./passkey-iam.service";
import { PasskeyManagementRepository, passkeyDenied } from "@/store/auth/passkey-management.repository";
import type { PasskeyManagementStore } from "@/store/auth/passkey-management.store";
import { PermissionService } from "@/services/users/permission.service";
import { Permission } from "@quyan/shared";
import { getIamPrincipal } from "@/iam/request/principal-context";

const logger = getLogger("PasskeyService", LogCategory.APPLICATION);

const RP_NAME = env.auth.webAuthn?.rpName;
const RP_ID = env.auth.webAuthn?.rpId;
const ORIGINS = env.auth.webAuthn?.origins;
const CHALLENGE_TTL = 300; // 5 minutes

export class PasskeyService {
  private static instance: PasskeyService;

  private constructor(
    private readonly redis: RedisService = RedisService.getInstance(),
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly passkeyCredentialRepository: PasskeyCredentialStore = PasskeyCredentialRepository.getInstance(),
    private readonly iam = PasskeyIamService.getInstance(),
    private readonly management: PasskeyManagementStore = PasskeyManagementRepository.getInstance(),
  ) {}

  public static getInstance(): PasskeyService {
    if (!PasskeyService.instance) PasskeyService.instance = new PasskeyService();
    return PasskeyService.instance;
  }

  private challengeKey(userId: string) {
    return `passkey:challenge:reg:${userId}`;
  }

  private authChallengeKey(sessionId: string) {
    return `passkey:challenge:auth:${sessionId}`;
  }

  private async legacyGuard(userId: string, request?: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (request && (!principal || principal.subjectUserId !== userId)) throw passkeyDenied();
    const result = await PermissionService.getInstance().checkUserPermissions(userId, [Permission.PASSKEY_MANAGE], {
      assumedRoleSessionId: principal?.roleSessionId,
    });
    if (!result.hasPermission) throw passkeyDenied();
  }

  private async registrationIdentity(
    userId: string,
    action: "quyan:auth:GetPasskeyRegistrationOptions" | "quyan:auth:RegisterPasskey",
    request?: TypedRequest,
  ) {
    if (env.security.iamAuthorizationMode === "enforce") return this.iam.authorizeRegistration(userId, action, request);
    await this.legacyGuard(userId, request);
    if (env.security.iamAuthorizationMode === "shadow" && request) {
      try {
        await this.iam.authorizeRegistration(userId, action, request);
      } catch {
        logger.warn("Passkey IAM shadow evaluation denied", { action, reason: "iam-evaluation-denied-or-unavailable" });
      }
    }
    return undefined;
  }

  async generateRegistrationOptions(userId: string, request?: TypedRequest) {
    const identity = await this.registrationIdentity(userId, "quyan:auth:GetPasskeyRegistrationOptions", request);
    const user = identity?.snapshot ?? (await this.userRepository.findById(userId));
    if (!user) throw new NotFoundError("User not found", undefined, { messageKey: "user.notFound" });

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: user.username,
      userDisplayName: user.name ?? user.username,
      // Do not disclose IDs for existing credentials outside the caller's ListPasskeys scope.
      // The unique credential constraint still prevents registering an existing credential twice.
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });

    if (identity) await this.registrationIdentity(userId, "quyan:auth:GetPasskeyRegistrationOptions", request);
    await this.redis.set(this.challengeKey(userId), options.challenge, CHALLENGE_TTL);
    return options;
  }

  async verifyRegistration(userId: string, response: RegistrationResponseJSON, name?: string, request?: TypedRequest) {
    const identity = await this.registrationIdentity(userId, "quyan:auth:RegisterPasskey", request);
    const challenge = await this.redis.get(this.challengeKey(userId));
    if (!challenge)
      throw new BadRequestError("Challenge expired or not found", undefined, {
        messageKey: "auth.passkeyChallengeExpired",
      });

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: ORIGINS,
        expectedRPID: RP_ID,
      });
    } catch {
      logger.warn("Passkey registration verification failed", { reason: "webauthn-verification-failed" });
      throw new BadRequestError("Registration verification failed", undefined, {
        messageKey: "auth.passkeyRegistrationFailed",
      });
    }

    if (!verification.verified || !verification.registrationInfo)
      throw new BadRequestError("Registration not verified", undefined, {
        messageKey: "auth.passkeyRegistrationNotVerified",
      });

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    const data = {
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter),
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: credential.transports ? JSON.stringify(credential.transports) : null,
      name: name ?? null,
    };
    // Consume exactly the verified challenge; concurrent verifies and Redis failures fail closed.
    if ((await this.redis.deleteIfValueMatches(this.challengeKey(userId), challenge)) !== true)
      throw new BadRequestError("Registration challenge already consumed", undefined, {
        messageKey: "auth.passkeyChallengeExpired",
      });
    if (identity) {
      await this.registrationIdentity(userId, "quyan:auth:RegisterPasskey", request);
      await this.management.create(identity.principal, identity.snapshot, data);
    } else await this.passkeyCredentialRepository.create(data);
    return { success: true, credentialId: credential.id };
  }

  async generateAuthenticationOptions() {
    const sessionId = crypto.randomUUID();
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      userVerification: "preferred",
    });
    await this.redis.set(
      this.authChallengeKey(sessionId),
      JSON.stringify({ challenge: options.challenge }),
      CHALLENGE_TTL,
    );
    return { options, sessionId };
  }

  async verifyAuthentication(sessionId: string, response: AuthenticationResponseJSON) {
    const raw = await this.redis.get(this.authChallengeKey(sessionId));
    if (!raw)
      throw new BadRequestError("Challenge expired or not found", undefined, {
        messageKey: "auth.passkeyChallengeExpired",
      });

    const { challenge } = JSON.parse(raw) as { challenge: string };

    const credential = await this.passkeyCredentialRepository.findByCredentialId(response.id);
    if (!credential)
      throw new NotFoundError("Credential not found", undefined, { messageKey: "auth.passkeyCredentialNotFound" });

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: ORIGINS,
        expectedRPID: RP_ID,
        credential: {
          id: credential.credentialId,
          publicKey: credential.publicKey,
          counter: Number(credential.counter),
          transports: credential.transports ? JSON.parse(credential.transports) : undefined,
        },
      });
    } catch {
      logger.warn("Passkey authentication verification failed", { reason: "webauthn-verification-failed" });
      throw new BadRequestError("Authentication verification failed", undefined, {
        messageKey: "auth.passkeyAuthenticationFailed",
      });
    }

    if (!verification.verified)
      throw new BadRequestError("Authentication not verified", undefined, {
        messageKey: "auth.passkeyAuthenticationNotVerified",
      });

    await this.passkeyCredentialRepository.updateCounter(
      credential.credentialId,
      BigInt(verification.authenticationInfo.newCounter),
    );

    await this.redis.delete(this.authChallengeKey(sessionId));
    return credential.userId;
  }

  async listCredentials(userId: string, request?: TypedRequest): Promise<PasskeyCredentialItem[]> {
    if (env.security.iamAuthorizationMode === "enforce") return this.iam.list(userId, request);
    await this.legacyGuard(userId, request);
    if (env.security.iamAuthorizationMode === "shadow" && request) {
      try {
        await this.iam.list(userId, request);
      } catch {
        logger.warn("Passkey IAM shadow evaluation denied", {
          action: "quyan:auth:ListPasskeys",
          reason: "iam-evaluation-denied-or-unavailable",
        });
      }
    }
    const creds = await this.passkeyCredentialRepository.listByUserId(userId);
    return creds.map((c) => ({
      id: c.id,
      credentialId: c.credentialId,
      name: c.name ?? undefined,
      deviceType: c.deviceType ?? undefined,
      backedUp: c.backedUp,
      createdAt: c.createTime.toISOString(),
    }));
  }

  async deleteCredential(userId: string, credentialId: string, request?: TypedRequest) {
    if (env.security.iamAuthorizationMode === "enforce") return this.iam.revoke(userId, credentialId, request);
    await this.legacyGuard(userId, request);
    if (env.security.iamAuthorizationMode === "shadow" && request) {
      try {
        // Shadow evaluates without performing the mutation.
        await this.iam.authorizeDeletion(userId, credentialId, request);
      } catch {
        logger.warn("Passkey IAM shadow evaluation denied", {
          action: "quyan:auth:DeletePasskey",
          reason: "iam-evaluation-denied-or-unavailable",
        });
      }
    }
    const cred = await this.passkeyCredentialRepository.findByCredentialId(credentialId);
    if (!cred || cred.userId !== userId)
      throw new NotFoundError("Credential not found", undefined, { messageKey: "auth.passkeyCredentialNotFound" });
    await this.passkeyCredentialRepository.deleteByCredentialId(credentialId);
  }
}
