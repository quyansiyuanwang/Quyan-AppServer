import { relayProbeAccountPublicSelect } from "./platform-relay-probe-account-read.repository";
import { prisma } from "@/config/database";
import { ConflictError } from "@/util/errors";

export class RelayChannelProbeAccountRepository {
  private static instance: RelayChannelProbeAccountRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelProbeAccountRepository());
  }
  list() {
    return prisma.relayChannelProbeAccount.findMany({ orderBy: { name: "asc" } });
  }
  async page(page: number, pageSize: number, search?: string) {
    const where = search ? { name: { contains: search } } : {};
    return prisma.$transaction(async (tx) => {
      const total = await tx.relayChannelProbeAccount.count({ where });
      const items = await tx.relayChannelProbeAccount.findMany({
        where,
        select: relayProbeAccountPublicSelect,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      const configured = new Set(
        (
          await tx.relayChannelProbeAccount.findMany({
            where: { id: { in: items.map((row) => row.id) }, encryptedCredentials: { not: "" } },
            select: { id: true },
          })
        ).map((row) => row.id),
      );
      return { total, items: items.map((row) => ({ ...row, hasCredentials: configured.has(row.id) })) };
    });
  }
  find(id: string) {
    return prisma.relayChannelProbeAccount.findUnique({ where: { id } });
  }
  findPublic(id: string) {
    return prisma.relayChannelProbeAccount.findUnique({ where: { id }, select: relayProbeAccountPublicSelect });
  }
  create(data: Parameters<typeof prisma.relayChannelProbeAccount.create>[0]["data"]) {
    return prisma.relayChannelProbeAccount.create({ data });
  }
  update(id: string, data: Parameters<typeof prisma.relayChannelProbeAccount.update>[0]["data"]) {
    return prisma.relayChannelProbeAccount.update({ where: { id }, data });
  }
  updateConfiguration(
    id: string,
    data: Parameters<typeof prisma.relayChannelProbeAccount.updateMany>[0]["data"],
    expectedCiphertext: string,
  ) {
    return prisma.$transaction(async (tx) => {
      const result = await tx.relayChannelProbeAccount.updateMany({
        where: { id, encryptedCredentials: expectedCiphertext },
        data,
      });
      if (result.count !== 1)
        throw new ConflictError("Probe account configuration changed", undefined, {
          messageKey: "relayChannelProbe.accountConfigurationChanged",
        });
      return tx.relayChannelProbeAccount.findUniqueOrThrow({ where: { id } });
    });
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
