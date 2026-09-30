import { prisma } from "@/config/database";

export class RelayChannelProbeAccountRepository {
  private static instance: RelayChannelProbeAccountRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelProbeAccountRepository());
  }
  list() {
    return prisma.relayChannelProbeAccount.findMany({ orderBy: { name: "asc" } });
  }
  find(id: string) {
    return prisma.relayChannelProbeAccount.findUnique({ where: { id } });
  }
  create(data: Parameters<typeof prisma.relayChannelProbeAccount.create>[0]["data"]) {
    return prisma.relayChannelProbeAccount.create({ data });
  }
  update(id: string, data: Parameters<typeof prisma.relayChannelProbeAccount.update>[0]["data"]) {
    return prisma.relayChannelProbeAccount.update({ where: { id }, data });
  }
  countBoundTargets(profileId: string) {
    return prisma.relayChannelProbeTargetConfig.count({ where: { profileId, accountId: { not: null } } });
  }
  countTargets(id: string) {
    return prisma.relayChannelProbeTargetConfig.count({ where: { accountId: id } });
  }
  delete(id: string) {
    return prisma.relayChannelProbeAccount.delete({ where: { id } });
  }
  findTarget(profileId: string, targetChannelId: string) {
    return prisma.relayChannelProbeTargetConfig.findUnique({
      where: { profileId_targetChannelId: { profileId, targetChannelId } },
    });
  }
  listTargets(profileIds: string[]) {
    return prisma.relayChannelProbeTargetConfig.findMany({ where: { profileId: { in: profileIds } } });
  }
  upsertTarget(
    profileId: string,
    targetChannelId: string,
    data: {
      accountId?: string | null;
      probeFormat?: string | null;
      probeModel?: string | null;
      probePayload?: import("@prisma/client").Prisma.InputJsonValue;
      probeGroup?: string | null;
    },
  ) {
    return prisma.relayChannelProbeTargetConfig.upsert({
      where: { profileId_targetChannelId: { profileId, targetChannelId } },
      create: { profileId, targetChannelId, ...data },
      update: data,
    });
  }
}
