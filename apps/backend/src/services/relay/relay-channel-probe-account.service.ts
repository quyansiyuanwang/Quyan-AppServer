import {
  PlatformRelayProbeAccountRefreshIamService,
  type ProbeAccountRefreshGuard,
} from "./platform-relay-probe-account-refresh-iam.service";
import { RELAY_PROBE_ACCOUNT_POLICY } from "./relay-probe-account-policy";
import { PlatformRelayProbeAccountCreateIamService } from "./platform-relay-probe-account-create-iam.service";
import { PlatformRelayProbeAccountUpdateIamService } from "./platform-relay-probe-account-update-iam.service";
import type { ProbeAccountEncryptedConfiguration } from "@/store/relay/platform-relay-probe-account-update.repository";
import { configureAIOutboundAgents } from "@/services/infrastructure/ai-http-agent-pool";
import axios from "axios";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "crypto";
import type { RelayChannelProbeAccount } from "@prisma/client";
import { env } from "@/config/env";
import { RedisService } from "@/services/infrastructure/redis.service";
import { RelayChannelProbeLockService } from "./relay-channel-probe-lock.service";
import { RelayChannelProbeAccountRepository } from "@/store/relay/relay-channel-probe-account.repository";
import { assertSafeOutboundUrl } from "@/util/developer-outbound-url";
import { BadRequestError, ConflictError, NotFoundError } from "@/util/errors";
import { interpolateRequiredProbeVariables, readProbeJsonPath } from "./probe-workflow.util";
import type {
  RelayChannelProbeLoginDto,
  SaveRelayChannelProbeAccountRequest,
} from "@/api/dto/relay/relay-channel-probe.dto";

import type { TypedRequest } from "@/types/express";
import { PlatformRelayProbeAccountReadIamService } from "./platform-relay-probe-account-read-iam.service";
import { PlatformRelayProbeAccountDeleteIamService } from "./platform-relay-probe-account-delete-iam.service";
import { projectRelayProbeAccount } from "./relay-probe-account-projection";

const PREFIX = RELAY_PROBE_ACCOUNT_POLICY.cachePrefix;
const LOCK_MS = RELAY_PROBE_ACCOUNT_POLICY.loginLockTtlMs;
const TOKEN_SAFETY_MS = RELAY_PROBE_ACCOUNT_POLICY.tokenSafetyMs;
type AccountError =
  | "accountBackendUnavailable"
  | "accountCredentialsRequired"
  | "accountReservedVariable"
  | "accountLoginCooldown"
  | "accountLoginInProgress"
  | "accountLoginFailed";
const bad = (key: AccountError) =>
  new BadRequestError("Probe account unavailable", undefined, { messageKey: `relayChannelProbe.${key}` });

type Encrypted = { ciphertext: string; iv: string; authTag: string };
type Session = { token: string; expiresAt: number };

export class RelayChannelProbeAccountService {
  private static instance: RelayChannelProbeAccountService;
  static getInstance() {
    return (this.instance ??= new RelayChannelProbeAccountService());
  }
  private readonly repository = RelayChannelProbeAccountRepository.getInstance();
  private readonly redis = RedisService.getInstance();

  private key(): Buffer {
    if (env.relay.channelProbe.masterKey.length < 64) throw bad("accountBackendUnavailable");
    return createHash("sha256").update(env.relay.channelProbe.masterKey).digest();
  }
  private encrypt(value: unknown): Encrypted {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]).toString("base64");
    return { ciphertext, iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
  }
  private decrypt(value: Encrypted): unknown {
    const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(value.iv, "base64"));
    decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
    return JSON.parse(
      Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8"),
    );
  }
  private cacheKey(id: string) {
    return `${PREFIX}:session:${id}`;
  }
  private lockKey(id: string) {
    return `${PREFIX}:login:${id}`;
  }
  private async readSession(id: string): Promise<Session | undefined> {
    if (!this.redis.isRedisAvailable()) throw bad("accountBackendUnavailable");
    const cached = await this.redis.get(this.cacheKey(id));
    if (!cached) return undefined;
    try {
      const parsed = JSON.parse(cached) as Encrypted;
      const session = this.decrypt(parsed) as Session;
      if (typeof session.token === "string" && session.expiresAt > Date.now() + TOKEN_SAFETY_MS) return session;
    } catch {
      /* Invalid cache entries are never used. */
    }
    return undefined;
  }
  private dto(account: RelayChannelProbeAccount, cached: boolean) {
    return projectRelayProbeAccount({ ...account, hasCredentials: Boolean(account.encryptedCredentials) }, cached);
  }
  async list(request?: TypedRequest) {
    return PlatformRelayProbeAccountReadIamService.getInstance().list(
      request,
      async (account) =>
        projectRelayProbeAccount(account, Boolean(await this.readSession(account.id).catch(() => undefined))),
      () => this.listLegacy(),
    );
  }
  private async listLegacy() {
    const accounts = await this.repository.list();
    return Promise.all(
      accounts.map(async (account) =>
        this.dto(account, Boolean(await this.readSession(account.id).catch(() => undefined))),
      ),
    );
  }
  async save(body: SaveRelayChannelProbeAccountRequest, id?: string, request?: TypedRequest) {
    if (id !== undefined)
      return PlatformRelayProbeAccountUpdateIamService.getInstance().update(
        id,
        body,
        (input, previous) => this.encryptConfiguration(input, previous),
        request,
        () => this.saveLegacy(body, id),
        async () => {
          await this.redis.delete(this.cacheKey(id));
        },
      );
    return PlatformRelayProbeAccountCreateIamService.getInstance().create(
      body,
      (input) => this.encryptConfiguration(input),
      request,
      (reservedId) => this.saveLegacy(body, undefined, reservedId),
    );
  }
  private encryptConfiguration(
    body: SaveRelayChannelProbeAccountRequest,
    previous?: ProbeAccountEncryptedConfiguration,
  ) {
    if (body.credentials && Object.hasOwn(body.credentials, "accountToken")) throw bad("accountReservedVariable");
    const variables =
      body.credentials ??
      (previous
        ? (
            this.decrypt({
              ciphertext: previous.encryptedCredentials,
              iv: previous.credentialIv,
              authTag: previous.credentialAuthTag,
            }) as { variables: Record<string, string> }
          ).variables
        : {});
    const encrypted = this.encrypt({ variables, workflow: body.loginWorkflow });
    return {
      encryptedCredentials: encrypted.ciphertext,
      credentialIv: encrypted.iv,
      credentialAuthTag: encrypted.authTag,
    };
  }
  private async saveLegacy(body: SaveRelayChannelProbeAccountRequest, id?: string, reservedId?: string) {
    const existing = id ? await this.repository.find(id) : null;
    if (id && !existing)
      throw new NotFoundError("Probe account not found", undefined, {
        messageKey: "relayChannelProbe.accountNotFound",
      });
    if (!existing && !body.credentials) throw bad("accountCredentialsRequired");
    // The entire login request can contain secrets, so it is always encrypted.
    const encrypted = this.encryptConfiguration(body, existing ?? undefined);
    const config = {
      name: body.name,
      tokenPath: body.tokenPath,
      expiresPath: body.expiresPath ?? null,
      expiresMode: body.expiresMode ?? null,
      fallbackTtlSeconds: body.fallbackTtlSeconds,
      minLoginIntervalSeconds: body.minLoginIntervalSeconds,
    };
    const account = existing
      ? await this.repository.update(existing.id, {
          ...config,
          ...encrypted,
        })
      : await this.repository.create({
          ...(reservedId ? { id: reservedId } : {}),
          ...config,
          ...encrypted,
        });
    if (existing) await this.redis.delete(this.cacheKey(account.id));
    return this.dto(account, false);
  }
  async remove(id: string, request?: TypedRequest) {
    return PlatformRelayProbeAccountDeleteIamService.getInstance().remove(
      id,
      request,
      () => this.removeLegacy(id),
      async () => {
        await this.redis.delete(this.cacheKey(id));
      },
    );
  }
  private async removeLegacy(id: string) {
    const account = await this.repository.find(id);
    if (!account)
      throw new NotFoundError("Probe account not found", undefined, {
        messageKey: "relayChannelProbe.accountNotFound",
      });
    if (await this.repository.countTargets(id))
      throw new ConflictError("Account is still bound", undefined, {
        messageKey: "relayChannelProbe.accountStillBound",
      });
    await this.repository.delete(id);
    await this.redis.delete(this.cacheKey(id));
  }
  async assertExists(id: string) {
    const account = await this.repository.find(id);
    if (!account)
      throw new NotFoundError("Probe account not found", undefined, {
        messageKey: "relayChannelProbe.accountNotFound",
      });
    return account;
  }
  async refresh(id: string, request?: TypedRequest) {
    return PlatformRelayProbeAccountRefreshIamService.getInstance().execute(
      id,
      request,
      () => this.refreshLegacy(id),
      (guard) => this.refreshNative(id, guard),
    );
  }
  private async refreshNative(id: string, guard: ProbeAccountRefreshGuard) {
    await guard.recheck();
    if (!this.redis.isRedisAvailable()) throw bad("accountBackendUnavailable");
    const previous = await this.redis.get(this.cacheKey(id));
    let published: string | undefined;
    try {
      await this.getToken(id, {
        recheck: guard.recheck,
        recordAttempt: guard.recordAttempt,
        publish: async (value, expiresAt) => {
          await guard.publish(async () => {
            published = value;
            await this.redis.set(
              this.cacheKey(id),
              value,
              Math.min(RELAY_PROBE_ACCOUNT_POLICY.cacheMaxTtlSeconds, Math.floor((expiresAt - Date.now()) / 1000)),
            );
            if ((await this.redis.get(this.cacheKey(id))) !== value) throw bad("accountBackendUnavailable");
          });
        },
      });
      const account = await this.repository.findPublic(id);
      if (!account)
        throw new NotFoundError("Probe account not found", undefined, {
          messageKey: "relayChannelProbe.accountNotFound",
        });
      await guard.recheck();
      return projectRelayProbeAccount({ ...account, hasCredentials: true }, true);
    } catch (error) {
      if (published !== undefined) await this.restoreRefreshSession(id, published, previous);
      throw error;
    }
  }
  private async restoreRefreshSession(id: string, published: string, previous: string | null) {
    try {
      if (previous) {
        const old = this.decrypt(JSON.parse(previous) as Encrypted) as Session;
        if (
          typeof old.token === "string" &&
          Number.isFinite(old.expiresAt) &&
          old.expiresAt > Date.now() + TOKEN_SAFETY_MS
        ) {
          const restored = await this.redis.replaceIfValueMatches(
            this.cacheKey(id),
            published,
            previous,
            Math.min(RELAY_PROBE_ACCOUNT_POLICY.cacheMaxTtlSeconds * 1000, old.expiresAt - Date.now()),
          );
          if (restored) return;
        }
      }
    } catch {
      /* Only an owned publication may be removed; never overwrite a newer session. */
    }
    await this.redis.deleteIfValueMatches(this.cacheKey(id), published).catch(() => null);
  }
  private async refreshLegacy(id: string) {
    // A manual refresh must not replace a token while any probe on this account
    // is measuring the same balance; use the exact lock key as executeRun.
    return RelayChannelProbeLockService.getInstance().withWrite(
      `probe-account:${id}`,
      async () => {
        const account = await this.assertExists(id);
        if (
          account.lastLoginAttemptAt &&
          Date.now() < account.lastLoginAttemptAt.getTime() + account.minLoginIntervalSeconds * 1000
        )
          throw bad("accountLoginCooldown");
        if (!this.redis.isRedisAvailable()) throw bad("accountBackendUnavailable");
        await this.redis.delete(this.cacheKey(id));
        await this.getToken(id);
        return this.dto(await this.assertExists(id), true);
      },
      RELAY_PROBE_ACCOUNT_POLICY.refreshLockWaitMs,
    );
  }
  async invalidateSession(id: string, observedToken: string): Promise<void> {
    if (!this.redis.isRedisAvailable()) throw bad("accountBackendUnavailable");
    const raw = await this.redis.get(this.cacheKey(id));
    if (!raw) return;
    let session: Session;
    try {
      session = this.decrypt(JSON.parse(raw) as Encrypted) as Session;
    } catch {
      throw bad("accountBackendUnavailable");
    }
    // Never evict a newer session written by another worker after the 401.
    if (session.token === observedToken) await this.redis.deleteIfValueMatches(this.cacheKey(id), raw);
  }

  async getToken(
    id: string,
    refresh?: {
      recheck: () => Promise<void>;
      recordAttempt: () => Promise<void>;
      publish: (value: string, expiresAt: number) => Promise<void>;
    },
  ): Promise<string> {
    await refresh?.recheck();
    await this.assertExists(id);
    if (!refresh) {
      const cached = await this.readSession(id);
      if (cached) return cached.token;
    }
    const lockId = randomUUID();
    const acquired = await this.redis.setIfNotExists(this.lockKey(id), lockId, LOCK_MS);
    if (acquired === null) throw bad("accountBackendUnavailable");
    if (!acquired) {
      if (refresh) throw bad("accountLoginInProgress");
      for (let attempt = 0; attempt < 110; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const renewed = await this.readSession(id);
        if (renewed) return renewed.token;
      }
      throw bad("accountLoginInProgress");
    }
    try {
      if (!refresh) {
        const renewed = await this.readSession(id);
        if (renewed) return renewed.token;
      }
      await refresh?.recheck();
      const latest = await this.assertExists(id);
      if (
        latest.lastLoginAttemptAt &&
        Date.now() < latest.lastLoginAttemptAt.getTime() + latest.minLoginIntervalSeconds * 1000
      )
        throw bad("accountLoginCooldown");
      if (refresh) await refresh.recordAttempt();
      else await this.repository.update(id, { lastLoginAttemptAt: new Date() });
      await refresh?.recheck();
      const stored = this.decrypt({
        ciphertext: latest.encryptedCredentials,
        iv: latest.credentialIv,
        authTag: latest.credentialAuthTag,
      });
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) throw bad("accountCredentialsRequired");
      const { variables: credentials, workflow } = stored as {
        variables: Record<string, string>;
        workflow: RelayChannelProbeLoginDto;
      };
      if (!credentials || !workflow?.url) throw bad("accountCredentialsRequired");
      let safe: Awaited<ReturnType<typeof assertSafeOutboundUrl>>;
      try {
        safe = configureAIOutboundAgents(
          await assertSafeOutboundUrl(interpolateRequiredProbeVariables(workflow.url, credentials) as string),
        );
      } catch {
        throw bad("accountLoginFailed");
      }
      let data: unknown;
      try {
        await refresh?.recheck();
        try {
          const response = await axios.request({
            method: workflow.method,
            url: safe.url.toString(),
            headers: interpolateRequiredProbeVariables(workflow.headers ?? {}, credentials) as Record<string, string>,
            params: interpolateRequiredProbeVariables(workflow.query ?? {}, credentials),
            data:
              workflow.method === "POST"
                ? interpolateRequiredProbeVariables(workflow.body ?? {}, credentials)
                : undefined,
            httpAgent: safe.httpAgent,
            httpsAgent: safe.httpsAgent,
            proxy: false,
            maxRedirects: 0,
            timeout: 15_000,
            maxContentLength: 1024 * 1024,
            validateStatus: (status) => status >= 200 && status < 300,
          });
          data = response.data;
        } catch {
          throw bad("accountLoginFailed");
        }
      } finally {
        safe.httpAgent.destroy();
        safe.httpsAgent.destroy();
      }
      await refresh?.recheck();
      const raw = readProbeJsonPath(data, latest.tokenPath);
      if (typeof raw !== "string" || !raw.trim()) throw bad("accountLoginFailed");
      const rawExpiry = latest.expiresPath ? readProbeJsonPath(data, latest.expiresPath) : undefined;
      const expiresAt =
        rawExpiry == null
          ? Date.now() + latest.fallbackTtlSeconds * 1000
          : latest.expiresMode === "seconds"
            ? Date.now() + Number(rawExpiry) * 1000
            : Date.parse(String(rawExpiry));
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + TOKEN_SAFETY_MS) throw bad("accountLoginFailed");
      const session = { token: raw, expiresAt };
      const encrypted = this.encrypt(session);
      if (refresh) {
        if ((await this.redis.get(this.lockKey(id))) !== lockId) throw bad("accountLoginInProgress");
        await refresh.publish(JSON.stringify(encrypted), expiresAt);
      } else
        await this.redis.set(
          this.cacheKey(id),
          JSON.stringify(encrypted),
          Math.min(RELAY_PROBE_ACCOUNT_POLICY.cacheMaxTtlSeconds, Math.floor((expiresAt - Date.now()) / 1000)),
        );
      if (!(await this.readSession(id))) throw bad("accountBackendUnavailable");
      return raw;
    } finally {
      await this.redis.deleteIfValueMatches(this.lockKey(id), lockId).catch(() => null);
    }
  }
}
