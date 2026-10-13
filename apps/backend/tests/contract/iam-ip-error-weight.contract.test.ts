import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const document = JSON.parse(readFileSync(resolve(process.cwd(), "src/build/swagger.json"), "utf8"));
describe("IP weight generated security metadata", () => {
  it.each(["put", "delete"])("retains replay, two-factor and JWT protection for %s", (method) => {
    const operation = document.paths["/v1/ip-blacklist/error-status/{ip}"][method];
    expect(operation["X-Replay-Protected"]).toBe(true);
    expect(operation["X-Two-Factor-Challenge"]).toMatchObject({ required: true, purpose: "stepup", method: "code" });
    expect(operation.security).toContainEqual({ jwt: [] });
    expect(operation.responses).toHaveProperty("401");
    expect(operation.responses).toHaveProperty("403");
  });
});
