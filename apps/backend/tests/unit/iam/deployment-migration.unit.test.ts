import { beforeEach, describe, expect, it, vi } from "vitest";
import { IamDeploymentMigration, parseIamDeploymentMigrationArgs } from "@/iam/migration/deployment-migration";
const empty = () => ({ planned: 0, migrated: 0, invalid: 0, changed: 0 });
const store = { listAccounts: vi.fn(), validateSources: vi.fn() };
const policies = { run: vi.fn() },
  authorizations = { run: vi.fn() };
const runner = new IamDeploymentMigration(store, policies, authorizations);
const scope = { apply: false, allAccounts: true };
beforeEach(() => {
  vi.resetAllMocks();
  store.listAccounts.mockResolvedValue([]);
  store.validateSources.mockResolvedValue(0);
  policies.run.mockImplementation(async () => empty());
  authorizations.run.mockImplementation(async () => empty());
});
describe("deployment IAM migration orchestration", () => {
  it("requires explicit mutually exclusive scope, defaults to dry-run and rejects unknown options", () => {
    expect(parseIamDeploymentMigrationArgs(["--", "--all-accounts"])).toEqual(scope);
    expect(parseIamDeploymentMigrationArgs(["--account-owner-id", "owner", "--apply"])).toEqual({
      apply: true,
      allAccounts: false,
      accountOwnerId: "owner",
    });
    for (const args of [
      [],
      ["--apply"],
      ["--all-accounts", "--account-owner-id", "owner"],
      ["--account-owner-id", "../other"],
      ["--all-accounts", "--force"],
    ])
      expect(() => parseIamDeploymentMigrationArgs(args)).toThrow();
  });
  it("paginates account inventory and does not write during dry-run", async () => {
    store.listAccounts.mockResolvedValueOnce(["owner-a"]).mockResolvedValueOnce(["owner-b"]);
    expect(await runner.run(scope)).toEqual({ mode: "dry-run", accounts: 2, verified: false });
    expect(store.listAccounts).toHaveBeenNthCalledWith(2, "owner-a");
    expect(policies.run.mock.calls).toEqual([
      [{ accountOwnerId: "owner-a", apply: false }],
      [{ accountOwnerId: "owner-b", apply: false }],
    ]);
    expect(authorizations.run).toHaveBeenCalledTimes(2);
  });
  it("checks all accounts before any writes, applies policies before bindings and verifies both", async () => {
    store.listAccounts.mockResolvedValueOnce(["owner-a", "owner-b"]);
    const events: string[] = [];
    expect(
      await runner.run({ ...scope, apply: true }, (event) =>
        events.push(event.stage + ":" + event.accountOwnerId + ":" + event.source),
      ),
    ).toEqual({ mode: "apply", accounts: 2, verified: true });
    const firstApply = events.findIndex((event) => event.startsWith("apply:"));
    expect(events.slice(0, firstApply)).toContain("preflight:owner-b:authorizations");
    expect(events.indexOf("apply:owner-a:policies")).toBeLessThan(events.indexOf("apply:owner-a:authorizations"));
    expect(events).toContain("verify:owner-b:authorizations");
  });
  it("does not partially apply earlier accounts when a later account fails preflight", async () => {
    store.listAccounts.mockResolvedValueOnce(["owner-a", "owner-b"]);
    policies.run.mockResolvedValueOnce(empty()).mockResolvedValueOnce({ ...empty(), invalid: 1 });
    await expect(runner.run({ ...scope, apply: true })).rejects.toMatchObject({ code: "invalid-data" });
    expect(policies.run.mock.calls.every(([options]) => options.apply === false)).toBe(true);
    expect(authorizations.run.mock.calls.every(([options]) => options.apply === false)).toBe(true);
  });
  it("rejects malformed global or user/group source permissions before converting policies", async () => {
    store.validateSources.mockResolvedValue(1);
    await expect(runner.run({ apply: true, allAccounts: false, accountOwnerId: "owner" })).rejects.toMatchObject({
      code: "invalid-sources",
    });
    expect(policies.run).not.toHaveBeenCalled();
    expect(authorizations.run).not.toHaveBeenCalled();
  });
  it("stops immediately on concurrent source drift and never reports verification success", async () => {
    policies.run.mockResolvedValueOnce(empty()).mockResolvedValueOnce({ ...empty(), changed: 1 });
    const event = vi.fn();
    await expect(runner.run({ apply: true, allAccounts: false, accountOwnerId: "owner" }, event)).rejects.toMatchObject(
      { code: "source-changed" },
    );
    expect(event.mock.calls.some(([value]) => value.stage === "verify")).toBe(false);
    expect(authorizations.run).toHaveBeenCalledTimes(1);
  });
  it("refuses completion if post-write verification still finds work", async () => {
    authorizations.run
      .mockResolvedValueOnce(empty())
      .mockResolvedValueOnce(empty())
      .mockResolvedValueOnce({ ...empty(), planned: 1 });
    await expect(runner.run({ apply: true, allAccounts: false, accountOwnerId: "owner" })).rejects.toMatchObject({
      code: "incomplete",
    });
  });
  it("checks source integrity after writes, including already converted policy versions", async () => {
    store.validateSources
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    await expect(runner.run({ apply: true, allAccounts: false, accountOwnerId: "owner" })).rejects.toMatchObject({
      code: "invalid-sources",
    });
  });
  it("rejects an unstable inventory and invalid programmatic scope without mutation", async () => {
    store.listAccounts.mockResolvedValueOnce(["owner"]).mockResolvedValueOnce(["owner"]);
    await expect(runner.run(scope)).rejects.toMatchObject({ code: "invalid-scope" });
    await expect(runner.run({ apply: true, allAccounts: false })).rejects.toMatchObject({ code: "invalid-scope" });
    expect(policies.run).not.toHaveBeenCalled();
  });
});
