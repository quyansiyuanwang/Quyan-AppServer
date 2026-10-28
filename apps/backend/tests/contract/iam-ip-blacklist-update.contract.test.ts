import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const document = JSON.parse(readFileSync(resolve(process.cwd(), "src/build/swagger.json"), "utf8"));
describe("blacklist update generated security metadata", () => {
  it.each([
    ["/v1/ip-blacklist/{ipAddress}", "put"],
    ["/v1/ip-blacklist/{ipAddress}", "delete"],
    ["/v1/ip-blacklist", "post"],
  ])("retains JWT, replay, two-factor and denial responses for %s %s", (path, method) => {
    const operation = document.paths[path][method];
    expect(operation["X-Replay-Protected"]).toBe(true);
    expect(operation["X-Two-Factor-Challenge"]).toMatchObject({ required: true, purpose: "stepup", method: "code" });
    expect(operation.security).toContainEqual({ jwt: [] });
    expect(operation.responses).toHaveProperty("401");
    expect(operation.responses).toHaveProperty("403");
  });
});
