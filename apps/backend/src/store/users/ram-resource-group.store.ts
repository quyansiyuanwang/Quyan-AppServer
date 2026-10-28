import type { IamManagementPageResult } from "@quyan/shared";
import type { IamManagementPage, IamManagementSearchPage } from "@/iam/management-pagination";
import type { RamResourceGroup, RamResourceGroupMember } from "@prisma/client";
export type RamResourceGroupWithMembers = RamResourceGroup & { members: RamResourceGroupMember[] };
export interface CreateRamResourceGroupInput {
  accountOwnerId: string;
  name: string;
  description?: string | null;
}
export interface CreateRamResourceGroupMemberInput {
  accountOwnerId: string;
  resourceGroupId: string;
  resourceArn: string;
  service: string;
  resourceType: string;
  resourceId: string;
  expectedGroupUpdateTime?: Date;
}
export interface RamResourceGroupStore {
  /** Active, exact-ARN membership metadata only; no resource contents or credentials. */
  conditionMemberships(accountOwnerId: string, resourceArns: readonly string[]): Promise<Map<string, string[]>>;
  list(accountOwnerId: string, page?: IamManagementPage): Promise<RamResourceGroupWithMembers[]>;
  listSummaryPage(
    accountOwnerId: string,
    page: IamManagementSearchPage,
  ): Promise<IamManagementPageResult<RamResourceGroup>>;
  listMemberPage(
    accountOwnerId: string,
    groupId: string,
    page: IamManagementPage,
  ): Promise<IamManagementPageResult<RamResourceGroupMember>>;
  findSummaryById(id: string): Promise<RamResourceGroup | null>;
  create(data: CreateRamResourceGroupInput): Promise<RamResourceGroup>;
  findById(id: string): Promise<RamResourceGroupWithMembers | null>;
  addMember(data: CreateRamResourceGroupMemberInput): Promise<RamResourceGroupMember>;
  resourceExistsInAccount(resourceArn: string, accountOwnerId: string): Promise<boolean>;
  removeMember(groupId: string, memberId: string, expectedGroupUpdateTime?: Date): Promise<void>;
}
