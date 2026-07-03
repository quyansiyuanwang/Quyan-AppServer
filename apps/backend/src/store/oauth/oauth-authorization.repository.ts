import type {
  OAuthAccessToken as _OAuthAccessToken,
  OAuthAuthorizationCode,
  OAuthClient,
  OAuthConsent,
  OAuthRefreshToken as _OAuthRefreshToken,
} from "@prisma/client";
import { prisma } from "@/config/database";
import { MANAGED_STATUS } from "@/constant/status";
import { getLogger, LogCategory } from "@/util/logger";
import type {
  OAuthAccessTokenWithClient,
  OAuthAuthorizationCodeCreateInput,
  OAuthAuthorizationCodeWithClient,
  OAuthAuthorizationStore,
  OAuthRefreshTokenWithClient,
  OAuthTokenPairCreateInput,
} from "./oauth-authorization.store";

const logger = getLogger("OAuthAuthorizationRepository", LogCategory.STORAGE);

export class OAuthAuthorizationRepository implements OAuthAuthorizationStore {
  private static instance: OAuthAuthorizationRepository;

  static getInstance(): OAuthAuthorizationRepository {
    if (!this.instance) this.instance = new OAuthAuthorizationRepository();
    return this.instance;
  }

  async findClientByClientId(clientId: string): Promise<OAuthClient | null> {
    try {
      return await prisma.oAuthClient.findFirst({
        where: { clientId, status: MANAGED_STATUS.ENABLED },
      });
    } catch (error) {
      logger.error(`Failed to find OAuth client by clientId: ${clientId}`, error);
      throw error;
    }
  }

  async findConsent(oauthClientId: string, userId: string): Promise<OAuthConsent | null> {
    try {
      return await prisma.oAuthConsent.findUnique({
        where: {
          oauthClientId_userId: {
            oauthClientId,
            userId,
          },
        },
      });
    } catch (error) {
      logger.error(`Failed to find OAuth consent: ${oauthClientId}/${userId}`, error);
      throw error;
    }
  }

  async upsertConsent(oauthClientId: string, userId: string, scopes: string[]): Promise<OAuthConsent> {
    try {
      return await prisma.oAuthConsent.upsert({
        where: {
          oauthClientId_userId: {
            oauthClientId,
            userId,
          },
        },
        create: {
          oauthClientId,
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
      logger.error(`Failed to upsert OAuth consent: ${oauthClientId}/${userId}`, error);
      throw error;
    }
  }

  async touchConsent(id: string, lastUsedAt: Date): Promise<void> {
    try {
      await prisma.oAuthConsent.update({
        where: { id },
        data: { lastUsedAt },
      });
    } catch (error) {
      logger.error(`Failed to touch OAuth consent: ${id}`, error);
      throw error;
    }
  }

  async createAuthorizationCode(data: OAuthAuthorizationCodeCreateInput): Promise<OAuthAuthorizationCode> {
    try {
      return await prisma.oAuthAuthorizationCode.create({
        data,
      });
    } catch (error) {
      logger.error("Failed to create OAuth authorization code", error);
      throw error;
    }
  }

  async findAuthorizationCodeByHash(codeHash: string): Promise<OAuthAuthorizationCodeWithClient | null> {
    try {
      return await prisma.oAuthAuthorizationCode.findFirst({
        where: {
          codeHash,
          status: MANAGED_STATUS.ENABLED,
        },
        include: {
          oauthClient: true,
        },
      });
    } catch (error) {
      logger.error("Failed to find OAuth authorization code", error);
      throw error;
    }
  }

  async issueTokenPairFromAuthorizationCode(params: {
    authorizationCodeId: string;
    tokenPair: OAuthTokenPairCreateInput;
  }): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.oAuthAuthorizationCode.update({
          where: { id: params.authorizationCodeId },
          data: { usedAt: new Date() },
        });

        await tx.oAuthAccessToken.create({
          data: {
            oauthClientId: params.tokenPair.oauthClientId,
            userId: params.tokenPair.userId,
            tokenHash: params.tokenPair.accessTokenHash,
            tokenJti: params.tokenPair.accessTokenJti,
            expiresAt: params.tokenPair.accessTokenExpiresAt,
            scopes: params.tokenPair.scopes,
          },
        });

        await tx.oAuthRefreshToken.create({
          data: {
            oauthClientId: params.tokenPair.oauthClientId,
            userId: params.tokenPair.userId,
            tokenHash: params.tokenPair.refreshTokenHash,
            expiresAt: params.tokenPair.refreshTokenExpiresAt,
          },
        });

        await tx.oAuthClient.update({
          where: { id: params.tokenPair.oauthClientId },
          data: { lastUsedAt: new Date() },
        });
      });
    } catch (error) {
      logger.error("Failed to issue OAuth token pair from authorization code", error);
      throw error;
    }
  }

  async findAccessTokenByHash(tokenHash: string): Promise<OAuthAccessTokenWithClient | null> {
    try {
      return await prisma.oAuthAccessToken.findFirst({
        where: {
          tokenHash,
          status: MANAGED_STATUS.ENABLED,
        },
        include: {
          oauthClient: true,
        },
      });
    } catch (error) {
      logger.error("Failed to find OAuth access token", error);
      throw error;
    }
  }

  async touchAccessTokenLastUsed(id: string, lastUsedAt: Date): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        const accessToken = await tx.oAuthAccessToken.update({
          where: { id },
          data: { lastUsedAt },
        });

        await tx.oAuthClient.update({
          where: { id: accessToken.oauthClientId },
          data: { lastUsedAt },
        });
      });
    } catch (error) {
      logger.error(`Failed to touch OAuth access token last used: ${id}`, error);
      throw error;
    }
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<OAuthRefreshTokenWithClient | null> {
    try {
      return await prisma.oAuthRefreshToken.findFirst({
        where: {
          tokenHash,
          status: MANAGED_STATUS.ENABLED,
        },
        include: {
          oauthClient: true,
        },
      });
    } catch (error) {
      logger.error("Failed to find OAuth refresh token", error);
      throw error;
    }
  }

  async rotateRefreshToken(params: { refreshTokenId: string; tokenPair: OAuthTokenPairCreateInput }): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.oAuthRefreshToken.update({
          where: { id: params.refreshTokenId },
          data: { revokedAt: new Date() },
        });

        await tx.oAuthAccessToken.create({
          data: {
            oauthClientId: params.tokenPair.oauthClientId,
            userId: params.tokenPair.userId,
            tokenHash: params.tokenPair.accessTokenHash,
            tokenJti: params.tokenPair.accessTokenJti,
            expiresAt: params.tokenPair.accessTokenExpiresAt,
            scopes: params.tokenPair.scopes,
          },
        });

        await tx.oAuthRefreshToken.create({
          data: {
            oauthClientId: params.tokenPair.oauthClientId,
            userId: params.tokenPair.userId,
            tokenHash: params.tokenPair.refreshTokenHash,
            expiresAt: params.tokenPair.refreshTokenExpiresAt,
          },
        });

        await tx.oAuthClient.update({
          where: { id: params.tokenPair.oauthClientId },
          data: { lastUsedAt: new Date() },
        });
      });
    } catch (error) {
      logger.error("Failed to rotate OAuth refresh token", error);
      throw error;
    }
  }

  async revokeTokenByHash(
    tokenHash: string,
    tokenTypeHint: "access_token" | "refresh_token" | undefined,
    oauthClientId: string,
  ): Promise<void> {
    try {
      const now = new Date();

      if (!tokenTypeHint || tokenTypeHint === "access_token")
        await prisma.oAuthAccessToken.updateMany({
          where: { tokenHash, revokedAt: null, oauthClientId },
          data: { revokedAt: now },
        });

      if (!tokenTypeHint || tokenTypeHint === "refresh_token")
        await prisma.oAuthRefreshToken.updateMany({
          where: { tokenHash, revokedAt: null, oauthClientId },
          data: { revokedAt: now },
        });
    } catch (error) {
      logger.error("Failed to revoke OAuth token", error);
      throw error;
    }
  }

  async touchClientLastUsed(id: string, lastUsedAt: Date): Promise<void> {
    try {
      await prisma.oAuthClient.update({
        where: { id },
        data: { lastUsedAt },
      });
    } catch (error) {
      logger.error(`Failed to touch OAuth client last used: ${id}`, error);
      throw error;
    }
  }
}
