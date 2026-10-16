import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
import type { Prisma } from "@prisma/client";
import { assertRelayChannelChangeProviderBindings } from "@/store/relay/relay-channel-change-provider-bindings";
const query = vi.fn(),
  users = vi.fn(),
  tx = { $queryRaw: query, user: { findMany: users } } as unknown as Prisma.TransactionClient;
const provider = (username = "name") => ({ username, commissionPercent: 1, settlementMode: "manual" as const });
const snapshot = (providerBindings: Prisma.InputJsonValue) => ({ providerBindings }) as Prisma.JsonValue;
beforeEach(() => {
  vi.resetAllMocks();
  query.mockResolvedValue([]);
  users.mockResolvedValue([{ id: "recipient", username: "name", status: 1 }]);
});
describe("pinned change proposal recipient identity", () => {
  it.each([null, {}, { providers: [] }] as Prisma.JsonValue[])(
    "retains compatibility for an unpinned legacy proposal %#",
    async (document) => {
      await assertRelayChannelChangeProviderBindings(tx, document, undefined);
      expect(query).not.toHaveBeenCalled();
      expect(users).not.toHaveBeenCalled();
    },
  );
  it("allows explicit empty providers without locking unrelated users", async () => {
    await assertRelayChannelChangeProviderBindings(tx, snapshot([]), []);
    expect(query).not.toHaveBeenCalled();
    expect(users).not.toHaveBeenCalled();
  });
  it.each(
    (
      [
        { userId: "recipient", username: "name" },
        [{ userId: "*", username: "name" }],
        [{ userId: "recipient", username: "name", extra: true }],
        [{ userId: "recipient", username: "different" }],
        [
          { userId: "recipient", username: "name" },
          { userId: "recipient", username: "other" },
        ],
      ] as Prisma.InputJsonValue[]
    ).map((bindings) => ({ bindings })),
  )("rejects malformed/mismatched identities before any database lookup %#", async ({ bindings }) => {
    await expect(assertRelayChannelChangeProviderBindings(tx, snapshot(bindings), [provider()])).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(query).not.toHaveBeenCalled();
    expect(users).not.toHaveBeenCalled();
  });
  it.each(["ids", "names", "providers"])("rejects duplicate %s even with matching list lengths", async (kind) => {
    const bindings =
      kind === "ids"
        ? [
            { userId: "recipient", username: "name" },
            { userId: "recipient", username: "other" },
          ]
        : [
            { userId: "recipient", username: "name" },
            { userId: "other", username: kind === "names" ? "name" : "other" },
          ];
    const providers = kind === "providers" ? [provider(), provider()] : [provider(), provider("other")];
    await expect(assertRelayChannelChangeProviderBindings(tx, snapshot(bindings), providers)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(query).not.toHaveBeenCalled();
  });
  it("requires a provider list whenever bindings are present", async () => {
    await expect(assertRelayChannelChangeProviderBindings(tx, snapshot([]), undefined)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(query).not.toHaveBeenCalled();
  });
  it("locks canonical recipient IDs and accepts only current active ID/name pairs", async () => {
    users.mockResolvedValue([
      { id: "a", username: "second", status: 1 },
      { id: "z", username: "name", status: 1 },
    ]);
    await assertRelayChannelChangeProviderBindings(
      tx,
      snapshot([
        { userId: "z", username: "name" },
        { userId: "a", username: "second" },
      ]),
      [provider(), provider("second")],
    );
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]![0].values).toEqual(["a", "z"]);
    expect(users).toHaveBeenCalledOnce();
  });
  it.each(
    [
      [],
      [{ id: "other", username: "name", status: 1 }],
      [{ id: "recipient", username: "renamed", status: 1 }],
      [{ id: "recipient", username: "name", status: 0 }],
    ].map((rows) => ({ rows })),
  )("rejects unavailable/rebound/disabled recipients %#", async ({ rows }) => {
    users.mockResolvedValue(rows);
    await expect(
      assertRelayChannelChangeProviderBindings(tx, snapshot([{ userId: "recipient", username: "name" }]), [provider()]),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
