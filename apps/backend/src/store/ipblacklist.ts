import { prisma } from "@/config/database";
import type { IPBlackList } from "@prisma/client";
import type { IPBlackListCreateInput, IPBlackListFindOptions, IPBlackListStore } from "./security/ipblacklist.store";
import { RECORD_STATUS } from "@/constant/status";

export type { IPBlackList } from "./security/ipblacklist.store";

export class IPBlackListRepository implements IPBlackListStore {
  private static instance: IPBlackListRepository;

  private constructor() {}

  static getInstance(): IPBlackListRepository {
    if (!IPBlackListRepository.instance) IPBlackListRepository.instance = new IPBlackListRepository();
    return IPBlackListRepository.instance;
  }

  async create(data: IPBlackListCreateInput): Promise<IPBlackList> {
    return prisma.iPBlackList.create({ data });
  }

  async findByIp(ipAddress: string): Promise<IPBlackList | null> {
    return prisma.iPBlackList.findFirst({ where: { ipAddress, status: RECORD_STATUS.ACTIVE } });
  }

  async findByIpAnyStatus(ipAddress: string): Promise<IPBlackList | null> {
    return prisma.iPBlackList.findFirst({ where: { ipAddress } });
  }

  async findAll(options?: IPBlackListFindOptions): Promise<{ blacklists: IPBlackList[]; total: number }> {
    const where: any = { status: RECORD_STATUS.ACTIVE };
    if (!options?.includeExpired) where.OR = [{ ExpireTime: null }, { ExpireTime: { gt: new Date() } }];

    const [blacklists, total] = await Promise.all([
      prisma.iPBlackList.findMany({
        where,
        skip: options?.offset,
        take: options?.limit,
        orderBy: { createTime: "desc" },
      }),
      prisma.iPBlackList.count({ where }),
    ]);
    return { blacklists, total };
  }

  async update(id: string, data: Partial<IPBlackList>): Promise<IPBlackList> {
    return prisma.iPBlackList.update({ where: { id }, data });
  }

  async delete(id: string): Promise<IPBlackList> {
    return prisma.iPBlackList.update({ where: { id }, data: { status: RECORD_STATUS.DELETED } });
  }

  async deleteByIp(ipAddress: string): Promise<boolean> {
    const record = await this.findByIp(ipAddress);
    if (!record) return false;
    await this.delete(record.id);
    return true;
  }

  async isBlacklisted(ipAddress: string): Promise<boolean> {
    const record = await prisma.iPBlackList.findFirst({
      where: {
        ipAddress,
        status: RECORD_STATUS.ACTIVE,
        OR: [{ ExpireTime: null }, { ExpireTime: { gt: new Date() } }],
      },
    });
    return !!record;
  }
}
