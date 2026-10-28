import type { Prisma } from "@prisma/client";
import type { RelayTokenAuthorityIdentity } from "./relay-token-authority";
import {
  RelayTokenMutationRepository,
  type RelayTokenMutationTarget,
  type RelayTokenMutationGuard,
} from "./relay-token-mutation.repository";
export type RelayTokenDeletionTarget = RelayTokenMutationTarget;
export type RelayTokenDeletionGuard = RelayTokenMutationGuard;
/** Fixed delete adapter; callers cannot choose another operation's identity ceilings. */
export class RelayTokenDeleteRepository {
  private static instance: RelayTokenDeleteRepository;
  static getInstance() {
    return (this.instance ??= new RelayTokenDeleteRepository());
  }
  private readonly mutations = RelayTokenMutationRepository.getInstance();
  tokenOwner(id: string) {
    return this.mutations.tokenOwner(id);
  }
  snapshot(identity: RelayTokenAuthorityIdentity, tx?: Prisma.TransactionClient) {
    return this.mutations.snapshot(identity, "delete", tx);
  }
  candidates(userId: string, ids: readonly string[], tx?: Prisma.TransactionClient) {
    return this.mutations.candidates(userId, ids, tx);
  }
  remove(targets: readonly RelayTokenDeletionTarget[], guard: RelayTokenDeletionGuard, persist: boolean) {
    return this.mutations.apply(targets, guard, { kind: "delete" }, persist);
  }
}
