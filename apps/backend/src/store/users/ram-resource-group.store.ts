import type { IamManagementPage } from "@/iam/management-pagination";
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
  list(accountOwnerId: string, page?: IamManagementPage): Promise<RamResourceGroupWithMembers[]>;
  create(data: CreateRamResourceGroupInput): Promise<RamResourceGroup>;
  findById(id: string): Promise<RamResourceGroupWithMembers | null>;
  addMember(data: CreateRamResourceGroupMemberInput): Promise<RamResourceGroupMember>;
  resourceExistsInAccount(resourceArn: string, accountOwnerId: string): Promise<boolean>;
  removeMember(groupId: string, memberId: string, expectedGroupUpdateTime?: Date): Promise<void>;
}
