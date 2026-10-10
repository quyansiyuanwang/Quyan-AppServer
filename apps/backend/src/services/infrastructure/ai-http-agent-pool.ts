import http from "node:http";
import https from "node:https";
import { getAIResourceConfig, getCurrentAIResourceConfig, AIResourceConfigService } from "./ai-resource-config.service";
import type { AIResourceSettingsDto } from "@/api/dto/system/ai-resources.dto";
type Limits = AIResourceSettingsDto["aiResources"]["http"];
export interface AIHttpAgents {
  httpAgent: http.Agent;
  httpsAgent: https.Agent;
}
interface Pool {
  key: string;
  agents: AIHttpAgents;
  refs: number;
  retired: boolean;
}
export class AIHttpAgentPool {
  private readonly pools = new Map<string, Pool>();
  private currentKey?: string;
  private key(limits: Limits) {
    return JSON.stringify(limits);
  }
  acquire(limits: Limits) {
    const key = this.key(limits);
    let pool = this.pools.get(key);
    if (!pool) {
      const options = {
        keepAlive: true,
        keepAliveMsecs: 30000,
        timeout: 60000,
        scheduling: "lifo" as const,
        ...limits,
      };
      pool = {
        key,
        agents: { httpAgent: new http.Agent(options), httpsAgent: new https.Agent(options) },
        refs: 0,
        retired: this.currentKey !== undefined && this.currentKey !== key,
      };
      this.pools.set(key, pool);
    }
    pool.refs++;
    let released = false;
    const entry = pool;
    return {
      agents: entry.agents,
      release: () => {
        if (released) return;
        released = true;
        entry.refs--;
        if (entry.retired && !entry.refs) this.destroy(entry);
      },
    };
  }
  rotate(limits: Limits) {
    const key = this.key(limits);
    this.currentKey = key;
    for (const pool of this.pools.values()) {
      pool.retired = pool.key !== key;
      if (pool.retired && !pool.refs) this.destroy(pool);
    }
  }
  private destroy(pool: Pool) {
    pool.agents.httpAgent.destroy();
    pool.agents.httpsAgent.destroy();
    this.pools.delete(pool.key);
  }
}
export const sharedAIHttpAgentPool = new AIHttpAgentPool();
let reader: (() => AIHttpAgents | undefined) | undefined;
export function registerAIHttpAgentReader(value: () => AIHttpAgents | undefined) {
  reader = value;
}
let idle: ReturnType<AIHttpAgentPool["acquire"]> | undefined;
let idleKey = "";
let subscribed = false;
export function getAIHttpAgents(): AIHttpAgents {
  const inherited = reader?.();
  if (inherited) return inherited;
  const limits = getAIResourceConfig().aiResources.http;
  const key = JSON.stringify(limits);
  if (!subscribed) {
    subscribed = true;
    AIResourceConfigService.getInstance().subscribe(() => {
      idle?.release();
      idle = undefined;
      idleKey = "";
      sharedAIHttpAgentPool.rotate(getCurrentAIResourceConfig().aiResources.http);
    });
  }
  if (key !== idleKey) {
    idle?.release();
    idle = sharedAIHttpAgentPool.acquire(limits);
    idleKey = key;
  }
  return idle!.agents;
}

/** Keep DNS-pinned Agents isolated while consuming the same deployment budget. */
export function configureAIOutboundAgents<T extends { httpAgent: http.Agent; httpsAgent: https.Agent }>(agents: T): T {
  const limits = getAIResourceConfig().aiResources.http;
  for (const agent of [agents.httpAgent, agents.httpsAgent]) {
    agent.maxSockets = limits.maxSockets;
    agent.maxTotalSockets = limits.maxTotalSockets;
    agent.maxFreeSockets = limits.maxFreeSockets;
  }
  return agents;
}
