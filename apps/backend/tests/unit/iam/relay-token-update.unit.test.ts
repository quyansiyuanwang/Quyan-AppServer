import type { Prisma } from "@prisma/client";
import { RELAY_TOKEN_ROUTING_LIMITS } from "@/constant/relay-token";
import { RELAY_COMPOSITION_POLICY } from "@/util/relay/relay-composition.util";
import { describe, it, expect, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { RelayTokenUpdateAdmissionRepository } from "@/store/relay/relay-token-update-admission.repository";
const own = "acs:relay:*:owner:token/actor/token";
const managed = "acs:platform:*:platform:relay-token/peer/token";
describe("complete token update authorization contract", () => {
  it("declares one server-fixed update Action with independent sensitive capabilities", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find((row) => row.key === "PUT /v1/relay/tokens/{id}"),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:UpdateToken"], issues: [] });
    const definition = getIamActionDefinition("quyan:relay:UpdateToken")!;
    expect(definition.conditionalActions).toEqual(
      expect.arrayContaining([
        "quyan:relay:GetToken",
        "quyan:relay:RevealToken",
        "quyan:relay:SelectTokenChannel",
        "quyan:relay:SetTokenCredential",
        "quyan:relay:ReferenceToken",
        "quyan:relay:BypassTokenCredentialLimits",
      ]),
    );
    expect(definition.requiredActions).toEqual(["quyan:relay:GetToken"]);
    expect(getIamActionDefinition("quyan:relay:SetTokenCredential")!.requiredActions).toEqual([
      "quyan:relay:RevealToken",
    ]);
    expect(getIamActionDefinition("quyan:relay:ReferenceManagedToken")!.requiredActions).toEqual([
      "quyan:relay:GetManagedToken",
    ]);
    expect(getIamActionDefinition("quyan:relay:UpdateManagedToken")!.authorizationBoundary).toBe("platform");
  });
  it.each(["UpdateToken", "SetTokenCredential", "ReferenceToken", "BypassTokenCredentialLimits"])(
    "does not interpret personal %s grants as platform grants",
    (name) => {
      expect(isIamActionResourceCompatible("quyan:relay:" + name, own)).toBe(true);
      expect(isIamActionResourceCompatible("quyan:relay:" + name, managed)).toBe(false);
    },
  );
  it("projects legacy UPDATE only to the author's writes and references, never credential setting or free limits", () => {
    const document = legacyPermissionsToPrincipalPolicy([Permission.RELAY_TOKEN_UPDATE], "owner", "actor")!;
    const decide = (action: string, resource: string) =>
      evaluatePolicies([{ policyId: "fixture", document }], { action: "quyan:relay:" + action, resource }).decision;
    expect(decide("UpdateToken", own)).toBe("Allow");
    expect(decide("ReferenceToken", own)).toBe("Allow");
    expect(decide("UpdateToken", "acs:relay:*:owner:token/peer/token")).toBe("ImplicitDeny");
    expect(decide("ReferenceToken", managed)).toBe("ImplicitDeny");
    expect(decide("SetTokenCredential", own)).toBe("ImplicitDeny");
    expect(decide("BypassTokenCredentialLimits", own)).toBe("ImplicitDeny");
  });
  it.each([Permission.RELAY_TOKEN_CUSTOM_KEY, Permission.RELAY_TOKEN_CUSTOM_KEY_FREE])(
    "maps setter compatibility for %s without widening personal scope",
    (permission) => {
      const document = legacyPermissionsToPrincipalPolicy([permission], "owner", "actor")!;
      const decide = (action: string, resource: string) =>
        evaluatePolicies([{ policyId: "fixture", document }], { action, resource }).decision;
      expect(decide("quyan:relay:SetTokenCredential", own)).toBe("Allow");
      expect(decide("quyan:relay:SetTokenCredential", "acs:relay:*:owner:token/peer/token")).toBe("ImplicitDeny");
      expect(decide("quyan:relay:BypassTokenCredentialLimits", own)).toBe(
        permission === Permission.RELAY_TOKEN_CUSTOM_KEY_FREE ? "Allow" : "ImplicitDeny",
      );
    },
  );
  it.each(["channelConfigs", "memberTokenConfigs"] as const)(
    "rejects truncated oversized %s sources without selecting secrets",
    async (field) => {
      const repository = new RelayTokenUpdateAdmissionRepository();
      const row = {
        id: "token",
        userId: "actor",
        channelConfigs: [],
        memberTokenConfigs: [],
        [field]: Array.from(
          {
            length:
              (field === "channelConfigs" ? RELAY_TOKEN_ROUTING_LIMITS.channels : RELAY_COMPOSITION_POLICY.maxMembers) +
              1,
          },
          () => ({}),
        ),
      };
      const read = vi.fn().mockResolvedValue(row);
      await expect(
        repository.source({ relayToken: { findFirst: read } } as unknown as Prisma.TransactionClient, "actor", "token"),
      ).rejects.toMatchObject({ statusCode: 403 });
      const select = read.mock.calls[0]![0].select;
      expect(select.channelConfigs.take).toBe(RELAY_TOKEN_ROUTING_LIMITS.channels + 1);
      expect(select.memberTokenConfigs.take).toBe(RELAY_COMPOSITION_POLICY.maxMembers + 1);
      for (const field of ["token", "legacyToken", "upstreamApiKey", "upstreamUrl"])
        expect(select).not.toHaveProperty(field);
    },
  );
  it("validates blocked references against complete live paths rather than independent member counts", () => {
    const repository = new RelayTokenUpdateAdmissionRepository();
    const pool = {
      id: "root",
      paths: [{ routingChannelIds: ["root", "logical", "leaf-a"] }, { routingChannelIds: ["root", "leaf-b"] }],
    };
    expect(repository.blocked(pool, [" leaf-a ", "leaf-a"])).toEqual(["leaf-a"]);
    expect(repository.blocked(pool, ["logical"])).toEqual(["logical"]);
    expect(() => repository.blocked(pool, ["logical", "leaf-b"])).toThrow();
    expect(() => repository.blocked(pool, ["root"])).toThrow();
    expect(() => repository.blocked(pool, ["foreign"])).toThrow();
    expect(() => repository.blocked({ id: "root", paths: [] }, [])).toThrow();
  });
});
