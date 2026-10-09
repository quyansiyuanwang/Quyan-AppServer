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

const PREFIX = "relay:probe-account:v1";
const LOCK_MS = 35_000;
const TOKEN_SAFETY_MS = 30_000;
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
    return {
      id: account.id,
      name: account.name,
      tokenPath: account.tokenPath,
      expiresPath: account.expiresPath ?? undefined,
      expiresMode: (account.expiresMode as "seconds" | "iso" | null) ?? undefined,
      fallbackTtlSeconds: account.fallbackTtlSeconds,
      minLoginIntervalSeconds: account.minLoginIntervalSeconds,
      lastLoginAttemptAt: account.lastLoginAttemptAt ?? undefined,
      nextLoginAt: account.lastLoginAttemptAt
        ? new Date(account.lastLoginAttemptAt.getTime() + account.minLoginIntervalSeconds * 1000)
        : undefined,
      cached,
      hasCredentials: Boolean(account.encryptedCredentials),
    };
  }
  async list() {
    const accounts = await this.repository.list();
    return Promise.all(
      accounts.map(async (account) =>
        this.dto(account, Boolean(await this.readSession(account.id).catch(() => undefined))),
      ),
    );
  }
  async save(body: SaveRelayChannelProbeAccountRequest, id?: string) {
    const existing = id ? await this.repository.find(id) : null;
    if (id && !existing)
      throw new NotFoundError("Probe account not found", undefined, {
        messageKey: "relayChannelProbe.accountNotFound",
      });
    if (!existing && !body.credentials) throw bad("accountCredentialsRequired");
    if (body.credentials && Object.hasOwn(body.credentials, "accountToken")) throw bad("accountReservedVariable");
    // Encrypt the entire login request, not just credential variables. Some upstreams
    // require sensitive static headers or body fields; neither belongs in a JSON column.
    const previous = existing
      ? (this.decrypt({
          ciphertext: existing.encryptedCredentials,
          iv: existing.credentialIv,
          authTag: existing.credentialAuthTag,
        }) as { variables: Record<string, string> })
      : undefined;
    const encrypted = this.encrypt({
      variables: body.credentials ?? previous?.variables ?? {},
      workflow: body.loginWorkflow,
    });
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
          encryptedCredentials: encrypted.ciphertext,
          credentialIv: encrypted.iv,
          credentialAuthTag: encrypted.authTag,
        })
      : await this.repository.create({
          ...config,
          encryptedCredentials: encrypted.ciphertext,
          credentialIv: encrypted.iv,
          credentialAuthTag: encrypted.authTag,
        });
    if (existing) await this.redis.delete(this.cacheKey(account.id));
    return this.dto(account, false);
  }
  async remove(id: string) {
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
  async refresh(id: string) {
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
      5 * 60_000,
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

  async getToken(id: string): Promise<string> {
    await this.assertExists(id);
    const cached = await this.readSession(id);
    if (cached) return cached.token;
    const lockId = randomUUID();
    const acquired = await this.redis.setIfNotExists(this.lockKey(id), lockId, LOCK_MS);
    if (acquired === null) throw bad("accountBackendUnavailable");
    if (!acquired) {
      for (let attempt = 0; attempt < 110; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const renewed = await this.readSession(id);
        if (renewed) return renewed.token;
      }
      throw bad("accountLoginInProgress");
    }
    try {
      const renewed = await this.readSession(id);
      if (renewed) return renewed.token;
      const latest = await this.assertExists(id);
      if (
        latest.lastLoginAttemptAt &&
        Date.now() < latest.lastLoginAttemptAt.getTime() + latest.minLoginIntervalSeconds * 1000
      )
        throw bad("accountLoginCooldown");
      await this.repository.update(id, { lastLoginAttemptAt: new Date() });
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
      } finally {
        safe.httpAgent.destroy();
        safe.httpsAgent.destroy();
      }
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
      await this.redis.set(
        this.cacheKey(id),
        JSON.stringify(encrypted),
        Math.min(86_400, Math.floor((expiresAt - Date.now()) / 1000)),
      );
      if (!(await this.readSession(id))) throw bad("accountBackendUnavailable");
      return raw;
    } finally {
      await this.redis.deleteIfValueMatches(this.lockKey(id), lockId).catch(() => null);
    }
  }
}
