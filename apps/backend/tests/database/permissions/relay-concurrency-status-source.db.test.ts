import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { RedisService } from "@/services/infrastructure/redis.service";
import { PlatformRelayConcurrencyReadRepository } from "@/store/relay/platform-relay-concurrency-read.repository";
let owner: string, actor: string;
const redis = RedisService.getInstance(),
  repository = PlatformRelayConcurrencyReadRepository.getInstance();
let keys: string[];
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "telemetry-source-" + randomUUID(),
        password: "fixture-only",
        permissionAdds: [],
        permissionRemoves: [],
        accountOwnerId,
      },
    })
  ).id;
beforeEach(async () => {
  vi.restoreAllMocks();
  keys = [];
  owner = await user();
  actor = await user(owner);
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (keys.length) expect(await redis.deleteMany(keys)).not.toBeNull();
});
async function write(key: string) {
  keys.push(key);
  expect(await redis.setWithResult(key, "fixture", 60)).toBe(true);
}
describe("confirmed persisted concurrency source", () => {
  it("reads identity metadata without hydrating user credentials and filters disabled owners", async () => {
    expect(await repository.users([owner, actor])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: actor, accountOwnerId: owner, status: 1 }),
        expect.objectContaining({ id: owner }),
      ]),
    );
    expect(JSON.stringify(await repository.users([actor]))).not.toContain("fixture-only");
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    expect(await repository.users([actor])).toEqual([]);
  });
  it("separates selected users from unrelated concurrency keys through confirmed SCAN pages", async () => {
    const key = `relay:concurrency:default:${actor}:slot:1`,
      other = `relay:concurrency:default:${owner}:slot:1`;
    await write(key);
    await write(other);
    const found: string[] = [];
    let cursor = "0";
    do {
      const page = await repository.scan("default", "slot", actor, cursor);
      found.push(...page.keys.map((row) => row.key));
      cursor = page.cursor;
    } while (cursor !== "0");
    expect(found).toEqual([key]);
    expect(await repository.ttl(key)).toBeGreaterThan(0);
    expect(await repository.ttl(`relay:concurrency:default:${actor}:slot:2`)).toBe(-2);
  });
  it("traverses more than 500 keys without truncation and exposes the real kind of each key", async () => {
    for (let i = 0; i < 501; i++) await write(`relay:concurrency:default:${actor}:slot:${i}`);
    const found = new Set<string>();
    let cursor = "0";
    do {
      const page = await repository.scan("default", "slot", actor, cursor);
      page.keys.forEach((row) => {
        expect(row.kind).toBe("slot");
        found.add(row.key);
      });
      cursor = page.cursor;
    } while (cursor !== "0");
    expect(found.size).toBe(501);
  });
  it("keeps configuration reads pure and protects the exact configuration revision", async () => {
    await prisma.relayConfig.deleteMany();
    const empty = await repository.configurationTarget();
    expect(empty.recordId).toBeNull();
    expect(await repository.hydrateConfiguration(empty)).toBeNull();
    expect(await prisma.relayConfig.count()).toBe(0);
    await prisma.relayConfig.create({ data: { maxConcurrency: 4 } });
    await expect(repository.hydrateConfiguration(empty)).rejects.toMatchObject({ statusCode: 403 });
  });
});
