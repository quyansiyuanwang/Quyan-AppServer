import { randomUUID } from "node:crypto";
import { createConnection, createServer, type Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { createRedisClient, getRedisConfig } from "@/config/redis";
import { env } from "@/config/env";

// Fault injection belongs only to the isolated runtime: the server applies a non-idempotent write,
// then this proxy loses its reply and disconnects. A reconnect must never replay that write.
describe("Redis ambiguous write transport behavior", () => {
  it("does not replay an applied command after losing its reply", async () => {
    const config = getRedisConfig(),
      key = "fixture-no-replay:" + randomUUID();
    const sockets = new Set<Socket>();
    let armed = false,
      dropped = false;
    const server = createServer((downstream) => {
      const upstream = createConnection({ host: config.host, port: config.port });
      sockets.add(downstream);
      sockets.add(upstream);
      let recent = "";
      downstream.on("data", (chunk) => {
        recent = (recent + chunk.toString("utf8")).slice(-4096);
        if (recent.includes(key) && !dropped) armed = true;
        upstream.write(chunk);
      });
      upstream.on("data", (chunk) => {
        if (armed && !dropped) {
          dropped = true;
          downstream.destroy();
          upstream.destroy();
          return;
        }
        downstream.write(chunk);
      });
      downstream.on("error", () => upstream.destroy());
      upstream.on("error", () => downstream.destroy());
      downstream.on("close", () => {
        sockets.delete(downstream);
        upstream.destroy();
      });
      upstream.on("close", () => {
        sockets.delete(upstream);
        downstream.destroy();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture listener unavailable");
    const originalPort = env.redis.port;
    let client: ReturnType<typeof createRedisClient> | undefined;
    try {
      env.redis.port = address.port;
      client = createRedisClient();
      env.redis.port = originalPort;
      await new Promise<void>((resolve, reject) => {
        client!.once("ready", resolve);
        client!.once("error", reject);
      });
      await expect(client.eval('return redis.call("INCR", KEYS[1])', 1, key)).rejects.toThrow();
      expect(dropped).toBe(true);
      expect(await client.get(key)).toBe("1");
      await client.del(key);
    } finally {
      env.redis.port = originalPort;
      client?.disconnect();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
