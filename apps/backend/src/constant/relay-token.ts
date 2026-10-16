/** Ordered token routing capacity, shared by request validation and persisted mutation proofs. */
export const RELAY_TOKEN_ROUTING_LIMITS = Object.freeze({ channels: 20 });

/** Bounded rollback window shared by native token mutations. */
export const RELAY_TOKEN_MUTATION_POLICY = Object.freeze({ timeoutMs: 30000 });
