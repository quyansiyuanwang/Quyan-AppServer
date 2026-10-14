import { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { assertIamAccountPrincipal, iamAccountDenied } from "../users/iam-account-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
const readPolicy = Object.freeze({ timeoutMs: 30000 });
/** Keep identity, policy ranges and every contributing decision stable through a personal collection read. */
export async function readPersonalTerminalCollection<T>(
  principal: IamPrincipal,
  decide: (resources: readonly string[]) => Promise<readonly string[]>,
  recheck: () => Promise<void>,
  read: (
    tx: Prisma.TransactionClient,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
  ) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await assertIamAccountPrincipal(principal, tx);
      await recheck();
      const revision = await readIamAuthorizationRevision(tx, principal.accountOwnerId),
        evaluations = new Map<string, string>();
      const checkedDecide = async (resources: readonly string[]) => {
        if (resources.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) throw iamAccountDenied();
        const outcomes = await decide(resources);
        if (
          outcomes.length !== resources.length ||
          outcomes.some((value) => !["Allow", "ExplicitDeny", "ImplicitDeny"].includes(value))
        )
          throw iamAccountDenied();
        resources.forEach((resource, index) => {
          const previous = evaluations.get(resource);
          if (previous !== undefined && previous !== outcomes[index]) throw iamAccountDenied();
          evaluations.set(resource, outcomes[index]!);
        });
        return outcomes;
      };
      const result = await read(tx, checkedDecide),
        entries = [...evaluations],
        limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
      for (let offset = 0; offset < entries.length; offset += limit) {
        const batch = entries.slice(offset, offset + limit),
          current = await decide(batch.map(([resource]) => resource));
        if (current.length !== batch.length || current.some((decision, index) => decision !== batch[index]![1]))
          throw iamAccountDenied();
      }
      await recheck();
      await assertIamAccountPrincipal(principal, tx);
      if ((await readIamAuthorizationRevision(tx, principal.accountOwnerId)) !== revision) throw iamAccountDenied();
      return result;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: readPolicy.timeoutMs },
  );
}
