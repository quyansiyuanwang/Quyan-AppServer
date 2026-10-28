import { beforeEach, describe, expect, it, vi } from "vitest";
import { Project } from "ts-morph";
import { readFileSync } from "node:fs";
const mocks = vi.hoisted(() => ({ target: vi.fn() }));
vi.mock("@/store/auth/passkey-management.repository", () => ({
  PasskeyManagementRepository: {
    getInstance: () => ({ target: mocks.target }),
  },
}));
import { passkeyResourceResolver } from "@/iam/request/passkey-resource-resolvers";
import { passkeyCredentialIdParamsSchema } from "@/api/schema/users/passkey.schema";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const principal = {
  subjectUserId: "actor",
  principalUserId: "actor",
  accountOwnerId: "owner",
  subjectType: "sub_user" as const,
};
const context = (id: unknown) => ({
  principal,
  request: {
    params: { credentialId: id },
    headers: { "x-action": "*" },
    query: { accountId: "foreign" },
  } as unknown as TypedRequest,
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.target.mockResolvedValue({ id: "database-id", userId: "actor" });
});
describe("Passkey endpoint metadata and resolver", () => {
  it("declares all JWT routes and leaves anonymous authentication outside IAM", () => {
    const file = "src/api/controllers/v1/users/passkey.controller.ts";
    const project = new Project({ useInMemoryFileSystem: true });
    const source = project.createSourceFile("/backend/" + file, readFileSync(file, "utf8"));
    const routes = collectIamRoutes([source], "/backend");
    const jwt = routes.filter((route) => route.security.includes("jwt"));
    expect(jwt).toHaveLength(4);
    expect(jwt.every((route) => route.coverage === "explicit" && route.issues.length === 0)).toBe(true);
    expect(jwt.flatMap((route) => route.actions).sort()).toEqual(
      [
        "quyan:auth:DeletePasskey",
        "quyan:auth:GetPasskeyRegistrationOptions",
        "quyan:auth:ListPasskeys",
        "quyan:auth:RegisterPasskey",
      ].sort(),
    );
    expect(routes.filter((route) => !route.security.includes("jwt"))).toHaveLength(2);
  });
  it("resolves the actual credential database ID with trusted ownership", async () => {
    expect(await passkeyResourceResolver(context("webauthn-id"))).toBe("acs:quyan:*:owner:passkey/actor/database-id");
    expect(mocks.target).toHaveBeenCalledWith(principal, "webauthn-id");
  });
  it.each(["*", "bad/id", " id", "id ", "", "x".repeat(2049)])("rejects malformed path %s", async (id) => {
    expect(passkeyCredentialIdParamsSchema.safeParse({ credentialId: id }).success).toBe(false);
    expect(await passkeyResourceResolver(context(id))).toBeUndefined();
    expect(mocks.target).not.toHaveBeenCalled();
  });
  it.each([null, { id: "key", userId: "peer" }, { id: "bad/id", userId: "actor" }])(
    "does not authorize an unavailable or misbound credential",
    async (target) => {
      mocks.target.mockResolvedValue(target);
      expect(await passkeyResourceResolver(context("webauthn-id"))).toBeUndefined();
    },
  );
});
