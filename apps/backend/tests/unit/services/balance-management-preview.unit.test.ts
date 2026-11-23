import { beforeEach, describe, expect, it, vi } from "vitest";
import { Decimal } from "@prisma/client/runtime/library";
import { DEFAULT_BALANCE_OVERDRAFT_RULE } from "@quyan/shared";
import { BalanceManagementService } from "@/services/billing/balance-management.service";
import type { TypedRequest } from "@/types/express";

const repository = { identitiesByUsernames: vi.fn(), targets: vi.fn() };
const guard = { recheck: vi.fn() };
const iam = { prepare: vi.fn() };
const overdraft = { resolve: vi.fn() };
const service = Object.assign(Object.create(BalanceManagementService.prototype), {
  repository,
  iam,
  overdraft,
}) as BalanceManagementService;
const request = {} as TypedRequest;
const alice = { id: "user-alice", username: "Alice", balanceAccount: null };
const bob = { id: "user-bob", username: "bob", balanceAccount: null };

beforeEach(() => {
  vi.resetAllMocks();
  iam.prepare.mockResolvedValue(guard);
  guard.recheck.mockResolvedValue(undefined);
  repository.identitiesByUsernames.mockResolvedValue([{ id: alice.id, username: alice.username }]);
  repository.targets.mockResolvedValue([alice]);
  overdraft.resolve.mockResolvedValue({
    rule: DEFAULT_BALANCE_OVERDRAFT_RULE,
    categories: ["relay"],
    limit: new Decimal(10),
    calculationError: false,
    defaultVersion: 1,
  });
});

describe("balance management username previews", () => {
  it("resolves trimmed deduplicated usernames before authorizing and reading their accounts", async () => {
    repository.identitiesByUsernames.mockResolvedValue([alice, bob].map(({ id, username }) => ({ id, username })));
    repository.targets.mockResolvedValue([alice, bob]);
    const result = await service.preview({ usernames: [" Alice ", "Alice", "bob"] }, request);
    expect(repository.identitiesByUsernames).toHaveBeenCalledExactlyOnceWith(["Alice", "bob"]);
    expect(iam.prepare).toHaveBeenNthCalledWith(1, "PreviewOverdraft", request);
    expect(iam.prepare).toHaveBeenNthCalledWith(2, "PreviewOverdraft", request, [alice.id, bob.id]);
    expect(repository.targets).toHaveBeenCalledExactlyOnceWith([alice.id, bob.id]);
    expect(result.map((row) => row.username)).toEqual(["Alice", "bob"]);
    expect(guard.recheck).toHaveBeenCalledOnce();
    expect(iam.prepare.mock.invocationCallOrder[0]).toBeLessThan(
      repository.identitiesByUsernames.mock.invocationCallOrder[0]!,
    );
    expect(iam.prepare.mock.invocationCallOrder[1]).toBeLessThan(repository.targets.mock.invocationCallOrder[0]!);
  });

  it("does not return a partial batch if a username is missing", async () => {
    await expect(service.preview({ usernames: ["Alice", "missing"] }, request)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(repository.targets).not.toHaveBeenCalled();
    expect(overdraft.resolve).not.toHaveBeenCalled();
  });

  it("does not resolve usernames without platform authorization", async () => {
    iam.prepare.mockRejectedValueOnce(new Error("Denied"));
    await expect(service.preview({ usernames: ["Alice"] }, request)).rejects.toThrow("Denied");
    expect(repository.identitiesByUsernames).not.toHaveBeenCalled();
    expect(repository.targets).not.toHaveBeenCalled();
  });

  it("does not hydrate balances when any resolved target is forbidden", async () => {
    iam.prepare.mockResolvedValueOnce(guard).mockRejectedValueOnce(new Error("Target denied"));
    await expect(service.preview({ usernames: ["Alice"] }, request)).rejects.toThrow("Target denied");
    expect(repository.targets).not.toHaveBeenCalled();
  });

  it("fails if a resolved user disappears before reading the account", async () => {
    repository.targets.mockResolvedValue([]);
    await expect(service.preview({ usernames: ["Alice"] }, request)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects the result if authorization changes during the preview", async () => {
    guard.recheck.mockRejectedValueOnce(new Error("Authorization changed"));
    await expect(service.preview({ usernames: ["Alice"] }, request)).rejects.toThrow("Authorization changed");
  });

  it("keeps ID previews compatible without using username lookup", async () => {
    const result = await service.preview({ userIds: [alice.id, alice.id] }, request);
    expect(result[0]?.userId).toBe(alice.id);
    expect(iam.prepare).toHaveBeenCalledExactlyOnceWith("PreviewOverdraft", request, [alice.id]);
    expect(repository.identitiesByUsernames).not.toHaveBeenCalled();
  });
});
