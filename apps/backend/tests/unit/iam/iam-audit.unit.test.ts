import { describe, expect, it, vi } from "vitest";
const logger = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("@/util/logger", () => ({ getLogger: () => logger, LogCategory: { SECURITY: "security" } }));
import { auditIamDecision, auditIamManagement } from "@/iam/audit/iam-audit.service";
describe("IAM structured audit", () => {
  it("includes matching authorization IDs and hashes the resource", () => {
    auditIamDecision({
      principal: { subjectUserId: "u", principalUserId: "u", accountOwnerId: "owner", subjectType: "sub_user" },
      action: "quyan:ram:ReadUser",
      resource: "acs:quyan:*:owner:user/secret-target",
      authorizationMode: "enforce",
      evaluationLatencyMs: 1,
      result: {
        decision: "Allow",
        reason: "matched-allow",
        matchedStatements: [{ policyId: "p", authorizationId: "a", statementId: "0", effect: "Allow" }],
      },
    });
    const fields = logger.info.mock.lastCall?.[1];
    expect(fields).toMatchObject({ matchedAuthorizationIds: ["a"], matchedPolicyIds: ["p"] });
    expect(fields.resourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(fields)).not.toContain("secret-target");
  });
  it("never spreads arbitrary request or policy fields into management events", () => {
    auditIamManagement({
      actorUserId: "u",
      accountOwnerId: "owner",
      operation: "create-authorization",
      targetId: "a",
      resourceArn: "acs:quyan:*:owner:user/private",
      document: { token: "sensitive" },
      authorization: "Bearer sensitive",
    } as never);
    const fields = logger.info.mock.lastCall?.[1];
    expect(fields.operation).toBe("create-authorization");
    expect(JSON.stringify(fields)).not.toMatch(/sensitive|Bearer|private|document/);
  });
});
