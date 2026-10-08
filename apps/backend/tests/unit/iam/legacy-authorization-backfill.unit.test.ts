import { beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { mockDeep } from "vitest-mock-extended";
import type { IamAuthorizationMigrationStore } from "@/store/users/iam-authorization-migration.store";
vi.mock("@/store/users/iam-authorization-migration.repository", () => ({
  IamAuthorizationMigrationRepository: { getInstance: vi.fn() },
}));
import { LegacyAuthorizationBackfillService } from "@/iam/migration/legacy-authorization-backfill.service";
import { planLegacyAuthorization } from "@/iam/migration/legacy-authorization-backfill";
import type { LegacyAuthorizationCandidate } from "@/iam/migration/legacy-authorization-backfill";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
const candidate: LegacyAuthorizationCandidate = {
  id: "binding",
  accountOwnerId: "owner",
  policyId: "policy",
  targetType: "user",
  targetId: "user",
  status: 1,
  updateTime: "2026-10-08T00:00:00.000Z",
  alreadyMigrated: false,
  principal: { accountOwnerId: "owner", status: 1 },
  policy: {
    accountOwnerId: "owner",
    status: 1,
    kind: "identity",
    format: "legacy",
    permissions: [Permission.RAM_USER_READ],
    version: null,
  },
};
const store = mockDeep<IamAuthorizationMigrationStore>();
const service = new LegacyAuthorizationBackfillService(store);
beforeEach(() => {
  vi.clearAllMocks();
  store.listCandidates.mockResolvedValue([]);
});
describe("historical account authorization migration", () => {
  it("plans stable documents without dropping legacy permissions", () => {
    const plan = planLegacyAuthorization(candidate);
    expect(plan).toMatchObject({
      kind: "migrate",
      sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      documentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(
      planLegacyAuthorization({ ...candidate, policy: { ...candidate.policy!, permissions: ["unmapped:permission"] } }),
    ).toEqual({ kind: "invalid", reason: "invalid-policy" });
  });
  it("checks JSON policy version integrity before marking an already migrated row as safe", () => {
    const parsed = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Deny", Action: "quyan:ram:ReadUser", Resource: "*" },
    });
    const policy = {
      ...candidate.policy!,
      format: "iam-v1",
      version: {
        id: "version",
        policyId: "policy",
        status: 1,
        validationState: "valid",
        document: parsed.document,
        documentHash: parsed.documentHash,
      },
    };
    expect(planLegacyAuthorization({ ...candidate, policy }).kind).toBe("migrate");
    expect(planLegacyAuthorization({ ...candidate, policy, alreadyMigrated: true })).toEqual({
      kind: "skip",
      reason: "already-migrated",
    });
    expect(
      planLegacyAuthorization({
        ...candidate,
        policy: { ...policy, version: { ...policy.version, documentHash: "corrupt" } },
        alreadyMigrated: true,
      }),
    ).toEqual({ kind: "invalid", reason: "invalid-policy" });
  });
  it.each([
    [{ targetType: "root" }, "unknown-principal-type"],
    [{ principal: null }, "missing-principal"],
    [{ principal: { accountOwnerId: "other", status: 1 } }, "cross-account"],
    [{ policy: { ...candidate.policy!, accountOwnerId: "other" } }, "cross-account"],
  ])("refuses unsafe principal or account relationships %#", (patch, reason) =>
    expect(planLegacyAuthorization({ ...candidate, ...patch } as LegacyAuthorizationCandidate)).toEqual({
      kind: "invalid",
      reason,
    }),
  );
  it("dry-runs with cursor pagination and emits only identifiers and hashes", async () => {
    store.listCandidates.mockResolvedValueOnce([candidate]);
    const onEvent = vi.fn();
    expect(await service.run({ onEvent })).toMatchObject({ mode: "dry-run", scanned: 1, planned: 1, migrated: 0 });
    expect(store.convert).not.toHaveBeenCalled();
    expect(store.listCandidates).toHaveBeenNthCalledWith(2, undefined, "binding");
    expect(Object.keys(onEvent.mock.calls[0][0]).sort()).toEqual([
      "accountOwnerId",
      "attachmentId",
      "documentHash",
      "outcome",
      "policyId",
    ]);
  });
  it("requires an explicit account for apply and reports source changes rather than overwriting them", async () => {
    await expect(service.run({ apply: true })).rejects.toThrow("explicit account owner");
    await expect(service.run({ accountOwnerId: "../foreign" })).rejects.toThrow();
    expect(store.listCandidates).not.toHaveBeenCalled();
    store.listCandidates.mockResolvedValueOnce([candidate]);
    store.convert.mockResolvedValue("source-changed");
    expect(await service.run({ apply: true, accountOwnerId: "owner" })).toMatchObject({
      planned: 1,
      changed: 1,
      migrated: 0,
    });
  });
});
