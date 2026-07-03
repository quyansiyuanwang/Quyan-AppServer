import type {
  AuthCenterAccessToken as _AuthCenterAccessToken,
  AuthCenterAuthorizationCode,
  AuthCenterClient,
  AuthCenterConsent,
  AuthCenterRefreshToken as _AuthCenterRefreshToken,
} from "@prisma/client";
import { prisma } from "@/config/database";
import { MANAGED_STATUS } from "@/constant/status";
import { getLogger, LogCategory } from "@/util/logger";
import type {
  AuthCenterAuthorizationCodeCreateInput,
  AuthCenterAuthorizationCodeWithClient,
  AuthCenterAuthorizationStore,
  AuthCenterRefreshTokenWithClient,
  AuthCenterTokenPairCreateInput,
} from "./auth-center-authorization.store";

const logger = getLogger("AuthCenterAuthorizationRepository", LogCategory.STORAGE);

export class AuthCenterAuthorizationRepository implements AuthCenterAuthorizationStore {
  private static instance: AuthCenterAuthorizationRepository;

  static getInstance(): AuthCenterAuthorizationRepository {
    if (!this.instance) this.instance = new AuthCenterAuthorizationRepository();
    return this.instance;
  }

  async findClientByClientId(clientId: string): Promise<AuthCenterClient | null> {
    try {
      return await prisma.authCenterClient.findFirst({
        where: { clientId, status: MANAGED_STATUS.ENABLED },
      });
    } catch (error) {
      logger.error(`Failed to find Auth Center client by clientId: ${clientId}`, error);
      throw error;
    }
  }

  async findConsent(authCenterClientId: string, userId: string): Promise<AuthCenterConsent | null> {
    try {
      return await prisma.authCenterConsent.findUnique({
        where: {
          authCenterClientId_userId: {
            authCenterClientId,
            userId,
          },
        },
      });
    } catch (error) {
      logger.error(`Failed to find Auth Center consent: ${authCenterClientId}/${userId}`, error);
      throw error;
    }
  }

  async upsertConsent(authCenterClientId: string, userId: string, scopes: string[]): Promise<AuthCenterConsent> {
    try {
      return await prisma.authCenterConsent.upsert({
        where: {
          authCenterClientId_userId: {
            authCenterClientId,
            userId,
          },
        },
        create: {
          authCenterClientId,
          userId,
          scopes,
          grantedAt: new Date(),
          lastUsedAt: new Date(),
        },
        update: {
          scopes,
          revokedAt: null,
          grantedAt: new Date(),
          lastUsedAt: new Date(),
          status: MANAGED_STATUS.ENABLED,
        },
      });
    } catch (error) {
      logger.error(`Failed to upsert Auth Center consent: ${authCenterClientId}/${userId}`, error);
      throw error;
    }
  }

  async touchConsent(id: string, lastUsedAt: Date): Promise<void> {
    try {
      await prisma.authCenterConsent.update({
        where: { id },
        data: { lastUsedAt },
      });
    } catch (error) {
      logger.error(`Failed to touch Auth Center consent: ${id}`, error);
      throw error;
    }
  }

  async createAuthorizationCode(data: AuthCenterAuthorizationCodeCreateInput): Promise<AuthCenterAuthorizationCode> {
    try {
      return await prisma.authCenterAuthorizationCode.create({ data });
    } catch (error) {
      logger.error("Failed to create Auth Center authorization code", error);
      throw error;
    }
  }

  async findAuthorizationCodeByHash(codeHash: string): Promise<AuthCenterAuthorizationCodeWithClient | null> {
    try {
      return await prisma.authCenterAuthorizationCode.findFirst({
        where: {
          codeHash,
          status: MANAGED_STATUS.ENABLED,
        },
        include: {
          authCenterClient: true,
        },
      });
    } catch (error) {
      logger.error("Failed to find Auth Center authorization code", error);
      throw error;
    }
  }

  async issueTokenPairFromAuthorizationCode(params: {
    authorizationCodeId: string;
    tokenPair: AuthCenterTokenPairCreateInput;
  }): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.authCenterAuthorizationCode.update({
          where: { id: params.authorizationCodeId },
          data: { usedAt: new Date() },
        });

        await tx.authCenterAccessToken.create({
          data: {
            authCenterClientId: params.tokenPair.authCenterClientId,
            userId: params.tokenPair.userId,
            subject: params.tokenPair.subject,
            tokenHash: params.tokenPair.accessTokenHash,
            tokenJti: params.tokenPair.accessTokenJti,
            expiresAt: params.tokenPair.accessTokenExpiresAt,
            scopes: params.tokenPair.scopes,
          },
        });

        if (params.tokenPair.refreshTokenHash && params.tokenPair.refreshTokenExpiresAt && params.tokenPair.userId)
          await tx.authCenterRefreshToken.create({
            data: {
              authCenterClientId: params.tokenPair.authCenterClientId,
              userId: params.tokenPair.userId,
              tokenHash: params.tokenPair.refreshTokenHash,
              expiresAt: params.tokenPair.refreshTokenExpiresAt,
            },
          });

        await tx.authCenterClient.update({
          where: { id: params.tokenPair.authCenterClientId },
          data: { lastUsedAt: new Date() },
        });
      });
    } catch (error) {
      logger.error("Failed to issue Auth Center token pair from authorization code", error);
      throw error;
    }
  }

  async issueClientCredentialsAccessToken(tokenPair: AuthCenterTokenPairCreateInput): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.authCenterAccessToken.create({
          data: {
            authCenterClientId: tokenPair.authCenterClientId,
            userId: tokenPair.userId,
            subject: tokenPair.subject,
            tokenHash: tokenPair.accessTokenHash,
            tokenJti: tokenPair.accessTokenJti,
            expiresAt: tokenPair.accessTokenExpiresAt,
            scopes: tokenPair.scopes,
          },
        });

        await tx.authCenterClient.update({
          where: { id: tokenPair.authCenterClientId },
          data: { lastUsedAt: new Date() },
        });
      });
    } catch (error) {
      logger.error("Failed to issue Auth Center client_credentials access token", error);
      throw error;
    }
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<AuthCenterRefreshTokenWithClient | null> {
    try {
      return await prisma.authCenterRefreshToken.findFirst({
        where: {
          tokenHash,
          status: MANAGED_STATUS.ENABLED,
        },
        include: {
          authCenterClient: true,
        },
      });
    } catch (error) {
      logger.error("Failed to find Auth Center refresh token", error);
      throw error;
    }
  }

  async rotateRefreshToken(params: {
    refreshTokenId: string;
    tokenPair: AuthCenterTokenPairCreateInput;
  }): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.authCenterRefreshToken.update({
          where: { id: params.refreshTokenId },
          data: { revokedAt: new Date() },
        });

        await tx.authCenterAccessToken.create({
          data: {
            authCenterClientId: params.tokenPair.authCenterClientId,
            userId: params.tokenPair.userId,
            subject: params.tokenPair.subject,
            tokenHash: params.tokenPair.accessTokenHash,
            tokenJti: params.tokenPair.accessTokenJti,
            expiresAt: params.tokenPair.accessTokenExpiresAt,
            scopes: params.tokenPair.scopes,
          },
        });

        if (!params.tokenPair.refreshTokenHash || !params.tokenPair.refreshTokenExpiresAt || !params.tokenPair.userId)
          throw new Error("Refresh token rotation requires refresh token payload");

        await tx.authCenterRefreshToken.create({
          data: {
            authCenterClientId: params.tokenPair.authCenterClientId,
            userId: params.tokenPair.userId,
            tokenHash: params.tokenPair.refreshTokenHash,
            expiresAt: params.tokenPair.refreshTokenExpiresAt,
          },
        });

        await tx.authCenterClient.update({
          where: { id: params.tokenPair.authCenterClientId },
          data: { lastUsedAt: new Date() },
        });
      });
    } catch (error) {
      logger.error("Failed to rotate Auth Center refresh token", error);
      throw error;
    }
  }

  async revokeTokenByHash(
    tokenHash: string,
    tokenTypeHint: "access_token" | "refresh_token" | undefined,
    authCenterClientId: string,
  ): Promise<void> {
    try {
      const now = new Date();

      if (!tokenTypeHint || tokenTypeHint === "access_token")
        await prisma.authCenterAccessToken.updateMany({
          where: { tokenHash, revokedAt: null, authCenterClientId },
          data: { revokedAt: now },
        });

      if (!tokenTypeHint || tokenTypeHint === "refresh_token")
        await prisma.authCenterRefreshToken.updateMany({
          where: { tokenHash, revokedAt: null, authCenterClientId },
          data: { revokedAt: now },
        });
    } catch (error) {
      logger.error("Failed to revoke Auth Center token", error);
      throw error;
    }
  }

  async touchClientLastUsed(id: string, lastUsedAt: Date): Promise<void> {
    try {
      await prisma.authCenterClient.update({
        where: { id },
        data: { lastUsedAt },
      });
    } catch (error) {
      logger.error(`Failed to touch Auth Center client last used: ${id}`, error);
      throw error;
    }
  }
}
