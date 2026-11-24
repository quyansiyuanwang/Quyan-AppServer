import { createHash } from "node:crypto";
import type {
  RelayCapabilityGraphNode,
  RelayCapabilityLeafCandidate,
} from "@/services/relay/relay-pool-resolver.service";
import { WriteInvalidatingCache } from "@/util/write-invalidating-cache";
import { RELAY_CATALOG_CACHE_POLICY } from "@/constant/relay-capability";
import { env } from "@/config/env";
import { prisma } from "@/config/database";
import { getLogger, LogCategory } from "@/util/logger";
import { buildRelayCatalogGraph } from "./relay-catalog-graph";
import { relayCatalogSourceSelect, type RelayCatalogSource } from "./relay-catalog-source";

type Graph = Map<string, RelayCapabilityGraphNode>;
type ResolveCandidates = (roots: string[], graph: Graph) => Promise<RelayCapabilityLeafCandidate[]>;
const revision = (sources: readonly RelayCatalogSource[]) =>
  createHash("sha256").update(JSON.stringify(sources)).digest("hex");

export class RelayCatalogGraphCache {
  private static instance: RelayCatalogGraphCache;
  static getInstance() {
    return (this.instance ??= new RelayCatalogGraphCache());
  }

  private readonly options = {
    ...RELAY_CATALOG_CACHE_POLICY,
    recomputeOnWrite: env.relay.catalogCache.recomputeOnWrite,
    onRefreshError: () =>
      getLogger("RelayCatalogCache", LogCategory.STORAGE).warn("Catalog cache warmup failed", {
        eventCode: "relay.catalog-cache.warmup-failed",
      }),
  };
  private readonly cache = new WriteInvalidatingCache<Graph>(this.options);
  private readonly candidates = new WriteInvalidatingCache<RelayCapabilityLeafCandidate[]>(this.options);

  get(sources: readonly RelayCatalogSource[]): Promise<Graph> {
    const ids = sources.map((row) => row.id);
    return this.cache.get(
      JSON.stringify(ids),
      revision(sources),
      async () => buildRelayCatalogGraph(sources),
      async () => {
        // Only internal derived data is warmed. No actor, token, request or IAM decision is retained.
        const rows = await this.readSources(ids);
        return { revision: revision(rows), value: buildRelayCatalogGraph(rows) };
      },
    );
  }

  resolve(
    sources: readonly RelayCatalogSource[],
    graph: Graph,
    roots: string[],
    derive: ResolveCandidates,
  ): Promise<RelayCapabilityLeafCandidate[]> {
    const ids = sources.map((row) => row.id),
      rootIds = [...new Set(roots)];
    return this.candidates.get(
      JSON.stringify([ids, rootIds]),
      revision(sources),
      () => derive(rootIds, graph),
      async () => {
        const rows = await this.readSources(ids);
        return { revision: revision(rows), value: await derive(rootIds, buildRelayCatalogGraph(rows)) };
      },
    );
  }

  async afterWrite<T>(committed: Promise<T>, persist = true): Promise<T> {
    const result = await committed;
    if (persist) {
      // Invalidate both synchronously before either asynchronous warmup can complete.
      await Promise.all([this.cache.invalidate(), this.candidates.invalidate()]);
    }
    return result;
  }

  private async readSources(ids: string[]): Promise<RelayCatalogSource[]> {
    const rows: RelayCatalogSource[] = [];
    for (let offset = 0; offset < ids.length; offset += RELAY_CATALOG_CACHE_POLICY.readBatchSize)
      rows.push(
        ...(await prisma.relayChannel.findMany({
          where: { id: { in: ids.slice(offset, offset + RELAY_CATALOG_CACHE_POLICY.readBatchSize) } },
          select: relayCatalogSourceSelect,
          orderBy: { id: "asc" },
        })),
      );
    return rows;
  }
}

/** This promise must resolve only after the outermost transaction has committed. */
export const afterRelayCatalogWrite = <T>(committed: Promise<T>, persist = true) =>
  persist ? RelayCatalogGraphCache.getInstance().afterWrite(committed) : committed;
