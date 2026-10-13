import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
type Client = Pick<
  Prisma.TransactionClient,
  | "ramPolicy"
  | "ramPolicyVersion"
  | "ramPolicyAttachment"
  | "ramAuthorization"
  | "ramRole"
  | "ramUserRoleBinding"
  | "ramGroupRoleBinding"
  | "ramRoleSession"
  | "ramResourceGroup"
  | "ramResourceGroupMember"
>;
const metadata = { id: true, status: true, updateTime: true } as const;
/** Account-scoped authorization revision. In a Serializable transaction these reads also
 * protect participating rows and ranges against concurrent policy/binding changes.
 * Caller holds actor/owner/global-group identity locks and re-evaluates grants before commit.
 * Never select role tokens, credential values, full policy documents or descriptions.
 */
export async function readIamAuthorizationRevision(client: Client, accountOwnerId: string): Promise<string> {
  const where = { accountOwnerId },
    orderBy = { id: "asc" } as const;
  // Keep read order stable across transactions. Do not parallelize Prisma transaction reads.
  const policies = await client.ramPolicy.findMany({
    where,
    orderBy,
    select: {
      ...metadata,
      defaultVersionId: true,
      documentFormat: true,
      validationState: true,
      policyKind: true,
      permissions: true,
    },
  });
  const versions = await client.ramPolicyVersion.findMany({
    where: { policy: { accountOwnerId } },
    orderBy,
    select: { ...metadata, policyId: true, version: true, documentHash: true, validationState: true },
  });
  const attachments = await client.ramPolicyAttachment.findMany({
    where,
    orderBy,
    select: { ...metadata, policyId: true, targetType: true, targetId: true },
  });
  const authorizations = await client.ramAuthorization.findMany({
    where,
    orderBy,
    select: {
      ...metadata,
      principalType: true,
      principalId: true,
      policyId: true,
      scopeType: true,
      scopeResourceId: true,
      scopeArn: true,
    },
  });
  const roles = await client.ramRole.findMany({ where, orderBy, select: metadata });
  const userRoles = await client.ramUserRoleBinding.findMany({
    where,
    orderBy,
    select: { ...metadata, userId: true, roleId: true },
  });
  const groupRoles = await client.ramGroupRoleBinding.findMany({
    where,
    orderBy,
    select: { ...metadata, groupId: true, roleId: true },
  });
  const sessions = await client.ramRoleSession.findMany({
    where,
    orderBy,
    select: { ...metadata, roleId: true, subjectUserId: true, expiresAt: true, revokedAt: true },
  });
  const groups = await client.ramResourceGroup.findMany({ where, orderBy, select: metadata });
  const members = await client.ramResourceGroupMember.findMany({
    where,
    orderBy,
    select: {
      ...metadata,
      resourceGroupId: true,
      resourceArn: true,
      service: true,
      resourceType: true,
      resourceId: true,
    },
  });
  return createHash("sha256")
    .update(
      JSON.stringify({
        policies,
        versions,
        attachments,
        authorizations,
        roles,
        userRoles,
        groupRoles,
        sessions,
        groups,
        members,
      }),
    )
    .digest("hex");
}
