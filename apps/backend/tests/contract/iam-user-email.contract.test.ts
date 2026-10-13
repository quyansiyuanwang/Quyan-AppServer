import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const document = JSON.parse(readFileSync(resolve(process.cwd(), "src/build/swagger.json"), "utf8"));
describe("email generated security metadata", () => {
  it.each([
    ["/v1/users/me/send-email-change-code", "post"],
    ["/v1/users/me/email", "patch"],
  ] as const)("preserves replay, two-factor and OAuth email contract for %s", (path, method) => {
    const operation = document.paths[path][method];
    expect(operation["X-Replay-Protected"]).toBe(true);
    expect(operation["X-Two-Factor-Challenge"]).toMatchObject({ required: true, purpose: "stepup", method: "code" });
    expect(operation.security).toContainEqual({ jwt: ["email"] });
    expect(operation.responses).toHaveProperty("401");
    expect(operation.responses).toHaveProperty("403");
  });
});
