import type { NormalizedIamPolicyDocument } from "@quyan/shared";
import { isIamPolicyResourceInAccount } from "@quyan/shared";
import { IamPolicyValidationError } from "./policy-parser";
/** Foreign account grants are rejected; registered platform grants still require a trusted global-group ceiling at runtime. */
export function assertIamPolicyAccount(document: NormalizedIamPolicyDocument, accountOwnerId: string): void {
  if (
    document.Statement.some((statement) =>
      statement.Resource.some((resource) => !isIamPolicyResourceInAccount(resource, accountOwnerId)),
    )
  )
    throw new IamPolicyValidationError();
}
