import { lockRamResourceGroup } from "./ram-resource-group-lock";
import type { IamManagementPage } from "@/iam/management-pagination";
import { iamManagementPaginationSchema } from "@/iam/management-pagination";
import { getIamResourceType } from "@quyan/shared";
import { prisma } from "@/config/database";
import { AccountStatus } from "@/util/auth/account-status";
import type {
  RamResourceGroupStore,
  CreateRamResourceGroupInput,
  CreateRamResourceGroupMemberInput,
} from "./ram-resource-group.store";
export class RamResourceGroupRepository implements RamResourceGroupStore {
  private static instance: RamResourceGroupRepository;
  static getInstance() {
    return (this.instance ??= new RamResourceGroupRepository());
  }
  list(accountOwnerId: string, page: IamManagementPage = iamManagementPaginationSchema.parse({})) {
    return prisma.ramResourceGroup.findMany({
      where: { accountOwnerId, status: AccountStatus.ACTIVE },
      include: { members: { where: { status: AccountStatus.ACTIVE }, orderBy: { createTime: "asc" } } },
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
    });
  }
  async listSummaryPage(accountOwnerId: string, page: IamManagementPage) {
    const records = await prisma.ramResourceGroup.findMany({
      where: { accountOwnerId, status: AccountStatus.ACTIVE },
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize + 1,
    });
    return { items: records.slice(0, page.pageSize), ...page, hasNext: records.length > page.pageSize };
  }
  async listMemberPage(accountOwnerId: string, groupId: string, page: IamManagementPage) {
    const records = await prisma.ramResourceGroupMember.findMany({
      where: {
        accountOwnerId,
        resourceGroupId: groupId,
        status: AccountStatus.ACTIVE,
        resourceGroup: { accountOwnerId, status: AccountStatus.ACTIVE },
      },
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize + 1,
    });
    return { items: records.slice(0, page.pageSize), ...page, hasNext: records.length > page.pageSize };
  }
  findSummaryById(id: string) {
    return prisma.ramResourceGroup.findFirst({ where: { id, status: AccountStatus.ACTIVE } });
  }
  create(data: CreateRamResourceGroupInput) {
    return prisma.ramResourceGroup.create({
      data: { ...data, status: AccountStatus.ACTIVE, description: data.description ?? null },
    });
  }
  findById(id: string) {
    return prisma.ramResourceGroup.findFirst({
      where: { id, status: AccountStatus.ACTIVE },
      include: { members: { where: { status: AccountStatus.ACTIVE } } },
    });
  }
  async resourceExistsInAccount(resourceArn: string, accountOwnerId: string): Promise<boolean> {
    const type = getIamResourceType(resourceArn);
    if (!type || resourceArn.split(":")[3] !== accountOwnerId) return false;
    const [, id, childId] = resourceArn.split(":")[4].split("/");
    const active = { status: AccountStatus.ACTIVE };
    const userOwner = { OR: [{ accountOwnerId }, { id: accountOwnerId, accountOwnerId: null }] };
    switch (type.id) {
      case "quyan/account":
        return Boolean(await prisma.user.findFirst({ where: { id: accountOwnerId, ...active } }));
      case "quyan/user":
        return Boolean(await prisma.user.findFirst({ where: { id, ...active, ...userOwner } }));
      case "quyan/group":
        return Boolean(await prisma.group.findFirst({ where: { id, accountOwnerId, ...active } }));
      case "quyan/role":
        return Boolean(await prisma.ramRole.findFirst({ where: { id, accountOwnerId, ...active } }));
      case "quyan/policy":
        return Boolean(await prisma.ramPolicy.findFirst({ where: { id, accountOwnerId, ...active } }));
      case "quyan/policy-version":
        return Boolean(
          await prisma.ramPolicyVersion.findFirst({
            where: { id: childId, policyId: id, ...active, policy: { accountOwnerId, ...active } },
          }),
        );
      case "quyan/authorization":
        return Boolean(await prisma.ramAuthorization.findFirst({ where: { id, accountOwnerId, ...active } }));
      case "quyan/resource-group":
        return Boolean(await prisma.ramResourceGroup.findFirst({ where: { id, accountOwnerId, ...active } }));
      case "quyan/role-session":
        return Boolean(
          await prisma.ramRoleSession.findFirst({
            where: { id, accountOwnerId, ...active, revokedAt: null, expiresAt: { gt: new Date() } },
          }),
        );
      case "article/article":
        return Boolean(await prisma.article.findFirst({ where: { id, ...active, author: userOwner } }));
      case "developer/project":
        return Boolean(await prisma.developerProject.findFirst({ where: { id, ...active, user: userOwner } }));
      // Shared/global channels have no account ownership. Only submission-owned channels may join a group.
      case "relay/channel":
        return Boolean(await prisma.relayChannel.findFirst({ where: { id, ...active, submittedBy: userOwner } }));
      default:
        return false;
    }
  }
  addMember(data: CreateRamResourceGroupMemberInput) {
    return prisma.$transaction(
      async (tx) => {
        const { expectedGroupUpdateTime, ...record } = data;
        await lockRamResourceGroup(tx, data.resourceGroupId, expectedGroupUpdateTime);
        return tx.ramResourceGroupMember.upsert({
          where: {
            resourceGroupId_resourceArn: { resourceGroupId: data.resourceGroupId, resourceArn: data.resourceArn },
          },
          create: { ...record, status: AccountStatus.ACTIVE },
          update: { status: AccountStatus.ACTIVE },
        });
      },
      { isolationLevel: "Serializable" },
    );
  }
  async removeMember(groupId: string, memberId: string, expectedGroupUpdateTime?: Date) {
    await prisma.$transaction(
      async (tx) => {
        await lockRamResourceGroup(tx, groupId, expectedGroupUpdateTime);
        await tx.ramResourceGroupMember.updateMany({
          where: { id: memberId, resourceGroupId: groupId, status: AccountStatus.ACTIVE },
          data: { status: AccountStatus.DELETED },
        });
      },
      { isolationLevel: "Serializable" },
    );
  }
}
