import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type { RelayTokenAuthorityIdentity } from "@/store/relay/relay-token-authority";
import {
  RelayTokenMutationResponseRepository,
  type RelayTokenMutationResponseTarget,
} from "@/store/relay/relay-token-mutation-response.repository";

vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/store/relay/relay-token-read.repository", () => ({ relayTokenReadSelect: {} }));

const findMany = vi.fn();
const tx = { relayToken: { findMany } } as unknown as Prisma.TransactionClient;
const identity = { userId: "fixture-user" } as RelayTokenAuthorityIdentity;
const repository = RelayTokenMutationResponseRepository.getInstance();
const target = (id: string): RelayTokenMutationResponseTarget => ({
  id,
  userId: identity.userId,
  status: 1,
  updateTime: new Date("2026-11-04T00:00:00.000Z"),
});

beforeEach(() => {
  findMany.mockReset();
});

describe("batched relay token response revision checks", () => {
  it("checks all 200 response revisions in one bounded transaction query on every call", async () => {
    const targets = Array.from({ length: 200 }, (_, index) => target(`fixture-${index}`));
    findMany.mockResolvedValue([...targets].reverse());
    await repository.verify(tx, identity, targets);
    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      where: { userId: identity.userId, id: { in: targets.map((row) => row.id) }, status: { in: [0, 1] } },
      select: { id: true, userId: true, status: true, updateTime: true },
    });
    findMany.mockResolvedValueOnce(targets.slice(1));
    await expect(repository.verify(tx, identity, targets)).rejects.toMatchObject({ statusCode: 403 });
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("deduplicates identical shared composite-member proofs without mutating caller snapshots", async () => {
    const shared = target("shared-member");
    const first = target("first");
    const last = target("last");
    const targets = [first, shared, last, { ...shared, updateTime: new Date(shared.updateTime) }];
    findMany.mockResolvedValue([first, shared, last]);
    await repository.verify(tx, identity, targets);
    expect(findMany.mock.calls[0]![0].where.id.in).toEqual(["first", "shared-member", "last"]);
    expect(targets).toHaveLength(4);
  });

  it.each(["userId", "status", "updateTime"] as const)(
    "rejects contradictory %s proofs instead of accepting a later projection",
    async (field) => {
      const original = target("shared");
      const changed = { ...original };
      if (field === "userId") changed.userId = "foreign-user";
      else if (field === "status") changed.status = 0;
      else changed.updateTime = new Date(original.updateTime.getTime() + 1);
      await expect(repository.verify(tx, identity, [original, changed])).rejects.toMatchObject({ statusCode: 403 });
      expect(findMany).not.toHaveBeenCalled();
    },
  );

  it.each(["missing", "foreign", "status", "revision", "unexpected", "duplicate"])(
    "fails closed for %s persisted response targets",
    async (kind) => {
      const first = target("first");
      const last = target("last");
      const changed = { ...last };
      if (kind === "foreign") changed.userId = "foreign-user";
      else if (kind === "status") changed.status = 0;
      else if (kind === "revision") changed.updateTime = new Date(last.updateTime.getTime() + 1);
      else if (kind === "unexpected") changed.id = "unexpected";
      findMany.mockResolvedValue(
        kind === "missing" ? [first] : kind === "duplicate" ? [first, first] : [first, changed],
      );
      await expect(repository.verify(tx, identity, [first, last])).rejects.toMatchObject({ statusCode: 403 });
    },
  );

  it("bounds each query and rejects drift in the last chunk", async () => {
    const limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
    const targets = Array.from({ length: limit + 1 }, (_, index) => target(`fixture-${index}`));
    findMany.mockResolvedValueOnce(targets.slice(0, limit)).mockResolvedValueOnce([]);
    await expect(repository.verify(tx, identity, targets)).rejects.toMatchObject({ statusCode: 403 });
    expect(findMany.mock.calls.map(([query]) => query.where.id.in.length)).toEqual([limit, 1]);
  });

  it("does not query when there are no projected responses", async () => {
    await repository.verify(tx, identity, []);
    expect(findMany).not.toHaveBeenCalled();
  });
});
