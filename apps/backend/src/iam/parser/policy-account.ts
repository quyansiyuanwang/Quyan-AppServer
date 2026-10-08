import type { NormalizedIamPolicyDocument } from "@quyan/shared";
import { matchIamPattern } from "@quyan/shared";
import { IamPolicyValidationError } from "./policy-parser";
/** Concrete foreign accounts are never persisted or loaded as an identity grant. */
export function assertIamPolicyAccount(document: NormalizedIamPolicyDocument, accountOwnerId: string): void {
  if (
    document.Statement.some((statement) =>
      statement.Resource.some(
        (resource) => resource !== "*" && !matchIamPattern(resource.split(":")[3], accountOwnerId),
      ),
    )
  )
    throw new IamPolicyValidationError();
}
