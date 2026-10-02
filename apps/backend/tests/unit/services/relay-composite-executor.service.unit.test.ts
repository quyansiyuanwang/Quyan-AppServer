import { describe, expect, it, vi } from "vitest";
import {
  RelayCompositeExecutorService,
  CompositeBranchUnavailable,
  bindCompositeContext,
  forkCompositeContext,
  consumeCompositeAttempt,
  type CompositeExecutionContext,
} from "@/services/relay/relay-composite-executor.service";
import { ContentSafetyBlockedError } from "@/util/errors";
import type { RelayTokenWithRelations } from "@/store/relay/relay-token.store";
const node = (id: string, children: string[] = []) =>
  ({
    id,
    userId: "owner",
    routingMode: children.length ? "composite" : "ordered",
    memberTokenConfigs: children.map((tokenId, priority) => ({ tokenId, priority, enabled: true })),
    failoverConfig: null,
  }) as unknown as RelayTokenWithRelations;
const context = (): CompositeExecutionContext => ({
  entryTokenId: "a",
  requestId: "server-request",
  attempts: 0,
  path: [],
  retryStatusCodes: [],
});
function run(nodes: RelayTokenWithRelations[], execute: any, options: any = {}) {
  const ctx = context();
  return new RelayCompositeExecutorService().execute(nodes[0], new Map(nodes.map((n) => [n.id, n])), {}, ctx, {
    check: async () => {},
    prepare: async (_token, input) => input,
    execute,
    committed: () => false,
    cancelled: () => false,
    ...options,
  });
}
describe("composite execution", () => {
  it("preserves ordered depth-first paths and fails over without committing", async () => {
    const execute = vi.fn(async (token, _request, ctx) => {
      if (token.id === "c") return { status: 503, headers: {}, data: {} };
      expect(ctx.path.map((n: any) => n.id)).toEqual(["a", "d"]);
      return { status: 200, headers: {}, data: { ok: true } };
    });
    const result = await run([node("a", ["b", "d"]), node("b", ["c"]), node("c"), node("d")], execute);
    expect(result.status).toBe(200);
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it("skips incompatible branches without spending retry slots", async () => {
    const a = node("a", ["b", "c", "d"]);
    a.failoverConfig = { enabled: true, maxRetries: 0, failoverThreshold: 0, retryStatusCodes: ["503"] } as any;
    const execute = vi.fn(async () => ({ status: 200, headers: {}, data: {} }));
    await run([a, node("b"), node("c"), node("d")], execute, {
      check: async (token: any) => {
        if (["b", "c"].includes(token.id)) throw new CompositeBranchUnavailable();
      },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it.each([400, 401, 403, 404])("does not retry non-retry status %s", async (status) => {
    const execute = vi.fn(async () => ({ status, headers: {}, data: {} }));
    expect((await run([node("a", ["b", "c"]), node("b"), node("c")], execute)).status).toBe(status);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("never retries after response commit", async () => {
    const execute = vi.fn(async () => ({ status: 503, headers: {}, data: {} }));
    await run([node("a", ["b", "c"]), node("b"), node("c")], execute, { committed: () => true });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("does not bypass content safety through a fallback", async () => {
    const execute = vi.fn(async () => {
      throw new ContentSafetyBlockedError();
    });
    await expect(run([node("a", ["b", "c"]), node("b"), node("c")], execute)).rejects.toBeInstanceOf(
      ContentSafetyBlockedError,
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("bounds actual upstream attempts across nested and normalizer retries", () => {
    const request = {};
    const ctx = context();
    bindCompositeContext(request, ctx);
    for (let i = 0; i < 100; i++) consumeCompositeAttempt(request);
    expect(() => consumeCompositeAttempt(request)).toThrow();
  });
  it("rejects runtime cycles and cancellation", async () => {
    await expect(run([node("a", ["a"])], vi.fn())).rejects.toThrow();
    await expect(run([node("a", ["b"]), node("b")], vi.fn(), { cancelled: () => true })).rejects.toThrow(
      "disconnected",
    );
  });
  it("disabled edges and different owners cannot execute", async () => {
    const a = node("a", ["b", "c"]);
    a.memberTokenConfigs[0].enabled = false;
    const c = node("c");
    c.userId = "other";
    const execute = vi.fn();
    await expect(run([a, node("b"), c], execute)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it("pins old attribution paths while sharing the global budget and lease", () => {
    const root = context();
    root.path = [node("a"), node("b")];
    const old = forkCompositeContext(root);
    root.path = [node("a"), node("c")];
    expect(old.path.map((item) => item.id)).toEqual(["a", "b"]);
    old.attempts++;
    expect(root.attempts).toBe(1);
    old.lease = { fixture: true };
    expect(root.lease).toEqual({ fixture: true });
    old.lastUpstreamStatus = 503;
    expect(root.lastUpstreamStatus).toBeUndefined();
  });
});
