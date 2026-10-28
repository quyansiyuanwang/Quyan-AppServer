import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { IAM_BACKFILL_BATCH_SIZE } from "@/iam/migration/legacy-policy-backfill";
import { parseLegacyPermissions } from "@/iam/legacy-policy";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { IAM_BACKFILL_CREATOR, isGeneratedLegacyPolicyDocument } from "@/iam/migration/legacy-policy-provenance";
import { parseIamTrustPolicy } from "@/iam/trust/trust-policy";
import { assertIamPolicyAccount } from "@/iam/parser/policy-account";

export interface IamMigrationSourceDiagnostic {
  source: "account" | "user" | "group" | "policy" | "role";
  sourceId: string;
  reason: "invalid-owner" | "invalid-permissions" | "invalid-version" | "invalid-trust" | "missing-trust-policy";
  severity: "error" | "warning";
}

/** Explicit client injection: the deployment runner never connects to an implicit application database. */
export class IamDeploymentMigrationRepository {
  readonly rolesWithoutTrust = new Set<string>();
  constructor(
    private readonly client: PrismaClient,
    private readonly options: {
      requireTrustPolicies?: boolean;
      onDiagnostic?: (diagnostic: IamMigrationSourceDiagnostic) => void;
    } = {},
  ) {}
  async listAccounts(afterId?: string): Promise<string[]> {
    const rows = await this.client.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM (
        SELECT COALESCE(accountOwnerId, id) AS id FROM users WHERE status = 1
        UNION SELECT accountOwnerId AS id FROM ram_policies WHERE status = 1
        UNION SELECT accountOwnerId AS id FROM ram_policy_attachments WHERE status = 1
        UNION SELECT accountOwnerId AS id FROM ram_roles WHERE status = 1
        UNION SELECT accountOwnerId AS id FROM \`groups\` WHERE status = 1 AND accountOwnerId IS NOT NULL
      ) AS owners WHERE id > ${afterId ?? ""} ORDER BY id LIMIT ${IAM_BACKFILL_BATCH_SIZE}
    `);
    return rows.map((row) => row.id);
  }
  async validateSources(accountOwnerId?: string): Promise<number> {
    let invalid = 0;
    const fail = (
      source: IamMigrationSourceDiagnostic["source"],
      sourceId: string,
      reason: IamMigrationSourceDiagnostic["reason"],
    ) => {
      invalid++;
      this.options.onDiagnostic?.({ source, sourceId, reason, severity: "error" });
    };
    const validatePermissions = (value: unknown, source: "user" | "group", sourceId: string) => {
      try {
        parseLegacyPermissions(value);
      } catch {
        fail(source, sourceId, "invalid-permissions");
      }
    };
    if (accountOwnerId !== undefined) {
      const owner = await this.client.user.findUnique({
        where: { id: accountOwnerId },
        select: { accountOwnerId: true },
      });
      if (!owner || owner.accountOwnerId !== null) fail("account", accountOwnerId, "invalid-owner");
      let afterId: string | undefined;
      for (;;) {
        const users = await this.client.user.findMany({
          where: {
            status: 1,
            OR: [{ id: accountOwnerId }, { accountOwnerId }],
            ...(afterId ? { id: { gt: afterId } } : {}),
          },
          select: { id: true, permissionAdds: true, permissionRemoves: true },
          orderBy: { id: "asc" },
          take: IAM_BACKFILL_BATCH_SIZE,
        });
        if (!users.length) break;
        for (const user of users) {
          validatePermissions(user.permissionAdds, "user", user.id);
          validatePermissions(user.permissionRemoves, "user", user.id);
        }
        afterId = users[users.length - 1].id;
      }
      afterId = undefined;
      for (;;) {
        const policies: Prisma.RamPolicyGetPayload<{ include: { defaultVersion: true } }>[] =
          await this.client.ramPolicy.findMany({
            where: { accountOwnerId, status: 1, policyKind: "identity", ...(afterId ? { id: { gt: afterId } } : {}) },
            include: { defaultVersion: true },
            orderBy: { id: "asc" },
            take: IAM_BACKFILL_BATCH_SIZE,
          });
        if (!policies.length) break;
        for (const policy of policies) {
          try {
            if (policy.documentFormat === "legacy") {
              if (policy.defaultVersionId) throw new Error("Invalid legacy version");
              parseLegacyPermissions(policy.permissions);
            } else if (policy.documentFormat === "iam-v1") {
              const version = policy.defaultVersion;
              if (
                !version ||
                version.policyId !== policy.id ||
                version.status !== 1 ||
                version.validationState !== "valid"
              )
                throw new Error("Invalid default version");
              const parsed = parseIamPolicy(version.document);
              assertIamPolicyAccount(parsed.document, accountOwnerId);
              if (parsed.documentHash !== version.documentHash) throw new Error("Invalid document hash");
              if (
                version.createdBy === IAM_BACKFILL_CREATOR &&
                !isGeneratedLegacyPolicyDocument(parsed.document, policy.permissions, accountOwnerId)
              )
                throw new Error("Invalid migration source");
            } else throw new Error("Invalid document format");
          } catch {
            fail("policy", policy.id, "invalid-version");
          }
        }
        afterId = policies[policies.length - 1].id;
      }
      afterId = undefined;
      for (;;) {
        const roles: { id: string; trustPolicy: Prisma.JsonValue }[] = await this.client.ramRole.findMany({
          where: { accountOwnerId, status: 1, ...(afterId ? { id: { gt: afterId } } : {}) },
          select: { id: true, trustPolicy: true },
          orderBy: { id: "asc" },
          take: IAM_BACKFILL_BATCH_SIZE,
        });
        if (!roles.length) break;
        for (const role of roles) {
          if (!role.trustPolicy) {
            this.rolesWithoutTrust.add(role.id);
            if (this.options.requireTrustPolicies) fail("role", role.id, "missing-trust-policy");
            else
              this.options.onDiagnostic?.({
                source: "role",
                sourceId: role.id,
                reason: "missing-trust-policy",
                severity: "warning",
              });
            continue;
          }
          this.rolesWithoutTrust.delete(role.id);
          try {
            const parsed = parseIamTrustPolicy(role.trustPolicy);
            assertIamPolicyAccount(parsed.document, accountOwnerId);
            if (
              parsed.document.Statement.some((statement) =>
                statement.Principal.RAM.some((arn) => arn.split(":")[3] !== accountOwnerId),
              )
            )
              fail("role", role.id, "invalid-trust");
          } catch {
            fail("role", role.id, "invalid-trust");
          }
        }
        afterId = roles[roles.length - 1].id;
      }
    }
    let afterId: string | undefined;
    for (;;) {
      const groups = await this.client.group.findMany({
        where: { accountOwnerId: accountOwnerId ?? null, status: 1, ...(afterId ? { id: { gt: afterId } } : {}) },
        select: { id: true, permissions: true },
        orderBy: { id: "asc" },
        take: IAM_BACKFILL_BATCH_SIZE,
      });
      if (!groups.length) break;
      for (const group of groups) validatePermissions(group.permissions, "group", group.id);
      afterId = groups[groups.length - 1].id;
    }
    return invalid;
  }
}
