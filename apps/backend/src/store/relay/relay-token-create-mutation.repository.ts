import { isRelayTokenResourceId } from "@/iam/resources/relay-token-resources";
import { RELAY_TOKEN_CREATION_LIMITS, RELAY_TOKEN_MUTATION_POLICY } from "@/constant/relay-token";
import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { RelayTokenCreateRepository } from "./relay-token-create.repository";
import type { RelayTokenCreateInput } from "./relay-token.store";
import {
  captureRelayTokenAuthority,
  RELAY_TOKEN_AUTHORITY_REQUIREMENTS,
  type RelayTokenAuthorityIdentity,
  type RelayTokenAuthoritySnapshot,
} from "./relay-token-authority";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { iamAccountDenied } from "../users/iam-account-principal";
import { ConflictError } from "@/util/errors";

/** Owns the one rollback boundary for creation, secondary proofs and response projection. */
export class RelayTokenCreateMutationRepository {
  private static instance: RelayTokenCreateMutationRepository;
  static getInstance() {
    return (this.instance ??= new RelayTokenCreateMutationRepository());
  }
  async apply<T>(input: {
    ids: readonly string[];
    identity: RelayTokenAuthorityIdentity;
    snapshot: RelayTokenAuthoritySnapshot;
    persist: boolean;
    recheck: (tx?: Prisma.TransactionClient) => Promise<void>;
    authorize: () => Promise<void>;
    prepare: (
      tx: Prisma.TransactionClient,
    ) => Promise<{ entries: readonly RelayTokenCreateInput[]; verify: (persisted: boolean) => Promise<void> }>;
    response: (tx: Prisma.TransactionClient) => Promise<T>;
  }): Promise<{ response?: T }> {
    const { identity, snapshot } = input;
    if (
      !input.ids.length ||
      input.ids.length > RELAY_TOKEN_CREATION_LIMITS.batch ||
      new Set(input.ids).size !== input.ids.length ||
      input.ids.some((id) => !isRelayTokenResourceId(id))
    )
      throw iamAccountDenied();
    const users = [
      ...new Set([identity.principal.subjectUserId, identity.principal.accountOwnerId, identity.userId]),
    ].sort();
    const groups = [
      ...new Set([snapshot.group?.id, snapshot.actorGroup?.id].filter((id): id is string => Boolean(id))),
    ].sort();
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(users)}) ORDER BY id FOR UPDATE`,
          );
          if (groups.length)
            await tx.$queryRaw(
              Prisma.sql`SELECT id FROM \`groups\` WHERE id IN (${Prisma.join(groups)}) ORDER BY id FOR UPDATE`,
            );
          const check = async () => {
            if (
              JSON.stringify(
                await captureRelayTokenAuthority(identity, RELAY_TOKEN_AUTHORITY_REQUIREMENTS.create, tx),
              ) !== JSON.stringify(snapshot)
            )
              throw iamAccountDenied();
            await input.recheck(tx);
          };
          await check();
          const revision = await readIamAuthorizationRevision(tx, identity.principal.accountOwnerId);
          await input.authorize();
          const plan = await input.prepare(tx);
          if (
            plan.entries.length !== input.ids.length ||
            plan.entries.some((entry) => entry.userId !== identity.userId)
          )
            throw iamAccountDenied();
          await plan.verify(false);
          await check();
          await input.authorize();
          if (input.persist)
            for (const [index, entry] of plan.entries.entries()) {
              const id = input.ids[index]!;
              if ((await RelayTokenCreateRepository.getInstance().apply(tx, entry, id)) !== id)
                throw iamAccountDenied();
            }
          await plan.verify(input.persist);
          const response = input.persist ? await input.response(tx) : undefined;
          await check();
          await input.authorize();
          if ((await readIamAuthorizationRevision(tx, identity.principal.accountOwnerId)) !== revision)
            throw iamAccountDenied();
          await plan.verify(input.persist);
          await input.recheck(tx);
          return input.persist ? { response } : {};
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: RELAY_TOKEN_MUTATION_POLICY.timeoutMs,
        },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2028"].includes(error.code))
        throw new ConflictError("Token creation context changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
}
