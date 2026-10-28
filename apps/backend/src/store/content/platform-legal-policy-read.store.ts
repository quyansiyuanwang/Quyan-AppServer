import type { LegalPolicyVersion } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
export type LegalPolicyReadTarget = Pick<
  LegalPolicyVersion,
  "id" | "status" | "policyType" | "version" | "createTime" | "updateTime"
>;
export type LegalPolicyListReadRow = Omit<LegalPolicyVersion, "content" | "contentFormat">;
export interface PlatformLegalPolicyReadStore {
  scan(principal: IamPrincipal, after?: string): Promise<LegalPolicyReadTarget[]>;
  target(principal: IamPrincipal, id: string): Promise<LegalPolicyReadTarget | null>;
  recheck(principal: IamPrincipal, targets: readonly LegalPolicyReadTarget[]): Promise<LegalPolicyReadTarget[]>;
  summaries(principal: IamPrincipal, targets: readonly LegalPolicyReadTarget[]): Promise<LegalPolicyListReadRow[]>;
  detail(principal: IamPrincipal, target: LegalPolicyReadTarget): Promise<LegalPolicyVersion | null>;
}
