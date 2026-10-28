import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_PERMISSIONS, Permission, actionForPermission } from "@quyan/shared";
import { mockDeep } from "vitest-mock-extended";
import { evaluatePolicyRequests } from "@/iam/evaluator/policy-evaluator";
import { planLegacyPolicy, parseIamBackfillArgs } from "@/iam/migration/legacy-policy-backfill";
import type { IamPolicyMigrationStore } from "@/store/users/iam-policy-migration.store";
vi.mock("@/store/users/iam-policy-migration.repository", () => ({
  IamPolicyMigrationRepository: { getInstance: vi.fn() },
}));
import { LegacyPolicyBackfillService } from "@/iam/migration/legacy-policy-backfill.service";
const candidate = {
  id: "policy",
  accountOwnerId: "owner",
  permissions: [Permission.USER_READ, Permission.RAM_USER_CREATE],
  type: "custom",
};
const store = mockDeep<IamPolicyMigrationStore>();
const service = new LegacyPolicyBackfillService(store);
describe("legacy policy backfill planning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.listCandidates.mockResolvedValue([]);
  });
  it("supports explicit package-manager separators and rejects unknown CLI options", () => {
    expect(parseIamBackfillArgs([])).toEqual({ apply: false, accountOwnerId: undefined });
    expect(parseIamBackfillArgs(["--", "--apply", "--account-owner-id", "owner"])).toEqual({
      apply: true,
      accountOwnerId: "owner",
    });
    expect(() => parseIamBackfillArgs(["--unknown"])).toThrow();
  });
  it("normalizes JSON strings and duplicate permissions into stable documents", () => {
    const first = planLegacyPolicy(candidate);
    const second = planLegacyPolicy({
      ...candidate,
      permissions: JSON.stringify([...candidate.permissions, Permission.USER_READ]),
    });
    expect(first.kind).toBe("migrate");
    expect(second.kind).toBe("migrate");
    if (first.kind !== "migrate" || second.kind !== "migrate") throw Error("Expected migration");
    expect(first.parsed.documentHash).toBe(second.parsed.documentHash);
    expect(first.parsed.document.Statement[0].Action).toContain(actionForPermission(Permission.USER_READ));
    expect(first.parsed.document.Statement[0].Resource).toEqual([
      "acs:platform:*:platform:user/*",
      "acs:quyan:*:owner:account",
      "acs:quyan:*:owner:group/*",
      "acs:quyan:*:owner:user/*",
    ]);
  });
  it.each(ALL_PERMISSIONS)("preserves shared native action grants for legacy permission %s", (permission) => {
    expect(planLegacyPolicy({ ...candidate, permissions: [permission] }).kind).toBe("migrate");
  });
  it("does not turn a shared native action into an unrelated legacy permission grant", () => {
    const plan = planLegacyPolicy({ ...candidate, permissions: [Permission.USER_CREATE] });
    expect(plan.kind).toBe("migrate");
    if (plan.kind !== "migrate") throw Error("Expected migration");
    const decisions = evaluatePolicyRequests(
      [{ policyId: candidate.id, document: plan.parsed.document }],
      [
        { action: "quyan:user:AssignUserGroup", resource: "acs:platform:*:platform:user/target" },
        { action: actionForPermission(Permission.USER_CREATE), resource: "acs:quyan:*:owner:account" },
        { action: actionForPermission(Permission.USER_UPDATE), resource: "acs:quyan:*:owner:account" },
      ],
    );
    expect(decisions.map((decision) => decision.decision)).toEqual(["Allow", "Allow", "ImplicitDeny"]);
  });
  it("preserves the union of native actions for a multi-permission policy", () => {
    expect(planLegacyPolicy({ ...candidate, permissions: ALL_PERMISSIONS }).kind).toBe("migrate");
  });
  it.each([["unknown:permission"], ["user:read", 12], null, "invalid-json"])(
    "reports unmapped/corrupt permissions without dropping them %#",
    (permissions) => {
      expect(planLegacyPolicy({ ...candidate, permissions })).toEqual({
        kind: "invalid",
        reason: "invalid-legacy-permissions",
      });
    },
  );
  it("skips empty and managed policies instead of inventing grants", () => {
    expect(planLegacyPolicy({ ...candidate, permissions: [] })).toEqual({ kind: "skip", reason: "empty-permissions" });
    expect(planLegacyPolicy({ ...candidate, type: "managed_product_owner" })).toEqual({
      kind: "skip",
      reason: "managed-policy",
    });
  });
  it("defaults to dry-run, paginates and reports only identifiers and hashes", async () => {
    store.listCandidates.mockResolvedValueOnce([candidate]);
    const onEvent = vi.fn();
    expect(await service.run({ onEvent })).toMatchObject({ mode: "dry-run", scanned: 1, planned: 1, migrated: 0 });
    expect(store.convert).not.toHaveBeenCalled();
    expect(store.listCandidates).toHaveBeenNthCalledWith(2, undefined, candidate.id);
    expect(Object.keys(onEvent.mock.calls[0][0]).sort()).toEqual([
      "accountOwnerId",
      "documentHash",
      "outcome",
      "policyId",
    ]);
  });
  it("requires account-scoped apply and refuses malformed scopes before reading data", async () => {
    await expect(service.run({ apply: true })).rejects.toThrow("explicit account owner");
    await expect(service.run({ accountOwnerId: "../other" })).rejects.toThrow();
    expect(store.listCandidates).not.toHaveBeenCalled();
  });
  it("counts unknown data, empty policies and concurrent source changes", async () => {
    store.listCandidates.mockResolvedValueOnce([
      candidate,
      { ...candidate, id: "empty", permissions: [] },
      { ...candidate, id: "invalid", permissions: ["unmapped"] },
    ]);
    store.convert.mockResolvedValue("source-changed");
    const report = await service.run({ apply: true, accountOwnerId: "owner" });
    expect(report).toMatchObject({ scanned: 3, planned: 1, invalid: 1, skipped: 1, changed: 1, migrated: 0 });
    expect(store.convert).toHaveBeenCalledTimes(1);
  });
});
