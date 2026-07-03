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
import { EnvSpace } from "@/config/env";

const logger = getLogger("PasskeyService", LogCategory.APPLICATION);

const RP_NAME = EnvSpace.webAuthnConfig?.rpName;
const RP_ID = EnvSpace.webAuthnConfig?.rpId;
const ORIGIN = EnvSpace.webAuthnConfig?.origin;
const CHALLENGE_TTL = 300; // 5 minutes

export class PasskeyService {
  private static instance: PasskeyService;

  private constructor(
    private readonly redis: RedisService = RedisService.getInstance(),
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly passkeyCredentialRepository: PasskeyCredentialStore = PasskeyCredentialRepository.getInstance(),
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

  async generateRegistrationOptions(userId: string) {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError("User not found");

    const existingCredentials = await this.passkeyCredentialRepository.findRegistrationViewByUserId(userId);

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: user.username,
      userDisplayName: user.name ?? user.username,
      excludeCredentials: existingCredentials.map((c) => ({
        id: c.credentialId,
        transports: c.transports ? JSON.parse(c.transports) : undefined,
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });

    await this.redis.set(this.challengeKey(userId), options.challenge, CHALLENGE_TTL);
    return options;
  }

  async verifyRegistration(userId: string, response: RegistrationResponseJSON, name?: string) {
    const challenge = await this.redis.get(this.challengeKey(userId));
    if (!challenge) throw new BadRequestError("Challenge expired or not found");

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
      });
    } catch (err) {
      logger.warn("Passkey registration verification failed:", err);
      throw new BadRequestError("Registration verification failed");
    }

    if (!verification.verified || !verification.registrationInfo)
      throw new BadRequestError("Registration not verified");

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    await this.passkeyCredentialRepository.create({
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter),
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: credential.transports ? JSON.stringify(credential.transports) : null,
      name: name ?? null,
    });

    await this.redis.delete(this.challengeKey(userId));
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
    if (!raw) throw new BadRequestError("Challenge expired or not found");

    const { challenge } = JSON.parse(raw) as { challenge: string };

    const credential = await this.passkeyCredentialRepository.findByCredentialId(response.id);
    if (!credential) throw new NotFoundError("Credential not found");

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        credential: {
          id: credential.credentialId,
          publicKey: credential.publicKey,
          counter: Number(credential.counter),
          transports: credential.transports ? JSON.parse(credential.transports) : undefined,
        },
      });
    } catch (err) {
      logger.warn("Passkey authentication verification failed:", err);
      throw new BadRequestError("Authentication verification failed");
    }

    if (!verification.verified) throw new BadRequestError("Authentication not verified");

    await this.passkeyCredentialRepository.updateCounter(
      credential.credentialId,
      BigInt(verification.authenticationInfo.newCounter),
    );

    await this.redis.delete(this.authChallengeKey(sessionId));
    return credential.userId;
  }

  async listCredentials(userId: string): Promise<PasskeyCredentialItem[]> {
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

  async deleteCredential(userId: string, credentialId: string) {
    const cred = await this.passkeyCredentialRepository.findByCredentialId(credentialId);
    if (!cred || cred.userId !== userId) throw new NotFoundError("Credential not found");
    await this.passkeyCredentialRepository.deleteByCredentialId(credentialId);
  }
}
