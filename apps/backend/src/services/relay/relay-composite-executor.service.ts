import { BadRequestError, ContentSafetyBlockedError } from "@/util/errors";
import { matchesRetryStatusRule } from "@/util/relay/relay-failover-status-rule.util";
import { RELAY_COMPOSITION_POLICY, compositionError } from "@/util/relay/relay-composition.util";
import type { RelayTokenWithRelations } from "@/store/relay/relay-token.store";

export interface CompositeExecutionContext {
  signal?: AbortSignal;
  entryTokenId: string;
  requestId: string;
  attempts: number;
  path: RelayTokenWithRelations[];
  retryStatusCodes: string[];
  lastUpstreamStatus?: number;
  lease?: unknown;
  stopHeartbeat?: () => void;
}
const contexts = new WeakMap<object, CompositeExecutionContext>();
export const getCompositeContext = (object: object | undefined): CompositeExecutionContext | undefined =>
  object && contexts.get(object);
export const bindCompositeContext = (object: object, context: CompositeExecutionContext): void => {
  contexts.set(object, context);
};
export const consumeCompositeAttempt = (request: object): void => {
  const context = getCompositeContext(request);
  if (context && ++context.attempts > RELAY_COMPOSITION_POLICY.maxUpstreamAttempts)
    throw new BadRequestError("Composite upstream attempt budget exhausted", undefined, {
      messageKey: "relayToken.compositionBudget",
    });
};
/** Pin per-attempt attribution even if an upstream callback completes after another branch starts. */
export function forkCompositeContext(context: CompositeExecutionContext): CompositeExecutionContext {
  const fork = { ...context, path: [...context.path], retryStatusCodes: [...context.retryStatusCodes] };
  Object.defineProperties(fork, {
    attempts: {
      get: () => context.attempts,
      set: (value: number) => {
        context.attempts = value;
      },
    },
    lease: {
      get: () => context.lease,
      set: (value: unknown) => {
        context.lease = value;
      },
    },
    stopHeartbeat: {
      get: () => context.stopHeartbeat,
      set: (value: (() => void) | undefined) => {
        context.stopHeartbeat = value;
      },
    },
  });
  return fork;
}

export class CompositeBranchUnavailable extends Error {}
export interface CompositeResult {
  status: number;
  headers: any;
  data: any;
}
export interface CompositeExecutorHost {
  check(token: RelayTokenWithRelations, request: any, ancestors: RelayTokenWithRelations[]): Promise<void>;
  orderMembers?(
    token: RelayTokenWithRelations,
    request: any,
    members: RelayTokenWithRelations["memberTokenConfigs"],
  ): Promise<RelayTokenWithRelations["memberTokenConfigs"]>;
  succeeded?(token: RelayTokenWithRelations, request: any, memberId: string): Promise<void>;
  prepare(token: RelayTokenWithRelations, request: any): Promise<any>;
  execute(token: RelayTokenWithRelations, request: any, context: CompositeExecutionContext): Promise<CompositeResult>;
  committed(): boolean;
  cancelled(): boolean;
}

/** Hierarchical failover: each node controls only switching between its direct children. */
export class RelayCompositeExecutorService {
  async execute(
    root: RelayTokenWithRelations,
    snapshot: Map<string, RelayTokenWithRelations>,
    request: any,
    context: CompositeExecutionContext,
    host: CompositeExecutorHost,
  ): Promise<CompositeResult> {
    const paths = new Set<string>();
    const visit = async (
      token: RelayTokenWithRelations,
      input: any,
      path: RelayTokenWithRelations[],
    ): Promise<CompositeResult> => {
      if (host.cancelled()) throw Object.assign(new Error("Client disconnected"), { name: "AbortError" });
      if (path.some((parent) => parent.id === token.id)) throw compositionError("cycle");
      if (path.length > RELAY_COMPOSITION_POLICY.maxDepth) throw compositionError("depth");
      await host.check(token, input, path);
      const nextPath = [...path, token];
      if (token.routingMode !== "composite") {
        paths.add(JSON.stringify(nextPath.map((node) => node.id)));
        if (paths.size > RELAY_COMPOSITION_POLICY.maxLeafPaths) throw compositionError("size");
        context.path = nextPath;
        context.lastUpstreamStatus = undefined;
        context.retryStatusCodes = nextPath.slice(0, -1).flatMap((parent) => {
          const rules = parent.failoverConfig?.retryStatusCodes;
          return Array.isArray(rules)
            ? rules.filter((rule): rule is string => typeof rule === "string")
            : [...RELAY_COMPOSITION_POLICY.retryStatusCodes];
        });
        return host.execute(token, input, context);
      }
      const prepared = await host.prepare(token, input);
      let members = [...(token.memberTokenConfigs ?? [])].sort((a, b) => a.priority - b.priority);
      if (members.length > RELAY_COMPOSITION_POLICY.maxMembers) throw compositionError("size");
      if (host.orderMembers) members = await host.orderMembers(token, input, members);
      const config = token.failoverConfig;
      const enabled = config?.enabled ?? true;
      const maxSwitches = config?.maxRetries ?? Math.max(0, members.length - 1);
      const threshold = config?.failoverThreshold ?? 0;
      const rules = Array.isArray(config?.retryStatusCodes)
        ? config.retryStatusCodes
        : RELAY_COMPOSITION_POLICY.retryStatusCodes;
      let switches = 0;
      let last: unknown = new CompositeBranchUnavailable();
      for (const edge of members) {
        const member = snapshot.get(edge.tokenId);
        if (!edge.enabled || !member || member.userId !== root.userId) continue;
        for (let retry = 0; retry <= threshold; retry++) {
          try {
            const result = await visit(member, prepared, nextPath);
            if (result.status < 400 || host.committed()) {
              if (result.status < 400 && switches > 0) await host.succeeded?.(token, input, edge.tokenId);
              return result;
            }
            last = Object.assign(new Error("Upstream member failed"), { upstreamStatus: result.status, result });
          } catch (error) {
            if (error instanceof CompositeBranchUnavailable) {
              last = error;
              break;
            }
            last = error;
          }
          if ((last as { messageKey?: string }).messageKey === "relayToken.compositionBudget") throw last;
          if (last instanceof ContentSafetyBlockedError || host.committed() || host.cancelled()) throw last;
          const failure = last as {
            upstreamStatus?: number;
            response?: { status?: number };
            status?: number;
            statusCode?: number;
            code?: string;
            name?: string;
          };
          if (failure.name === "AbortError" || failure.code === "ERR_CANCELED") throw last;
          const status =
            failure.upstreamStatus ??
            failure.response?.status ??
            context.lastUpstreamStatus ??
            failure.statusCode ??
            failure.status;
          const retryable = status != null && rules.some((rule) => matchesRetryStatusRule(status, rule));
          if (!enabled || !retryable) {
            const result = (last as { result?: CompositeResult }).result;
            if (result) return result;
            throw last;
          }
          if (retry === threshold) {
            if (switches++ >= maxSwitches) {
              const result = (last as { result?: CompositeResult }).result;
              if (result) return result;
              throw last;
            }
          }
        }
      }
      throw last;
    };
    try {
      return await visit(root, request, []);
    } catch (error) {
      if (error instanceof CompositeBranchUnavailable)
        throw new BadRequestError("No eligible composite path", undefined, {
          messageKey: "relayToken.compositionUnavailable",
        });
      throw error;
    }
  }
}
