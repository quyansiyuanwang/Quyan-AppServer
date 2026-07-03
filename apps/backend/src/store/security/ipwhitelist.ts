import { prisma } from "@/config/database";
import type { IPWhiteList } from "@prisma/client";
import type { IPWhiteListCreateInput, IPWhiteListFindOptions, IPWhiteListStore } from "./ipwhitelist.store";
import { RECORD_STATUS } from "@/constant/status";

export type { IPWhiteList } from "./ipwhitelist.store";

export class IPWhiteListRepository implements IPWhiteListStore {
  private static instance: IPWhiteListRepository;
  private constructor() {}

  static getInstance(): IPWhiteListRepository {
    if (!IPWhiteListRepository.instance) IPWhiteListRepository.instance = new IPWhiteListRepository();
    return IPWhiteListRepository.instance;
  }

  async create(data: IPWhiteListCreateInput): Promise<IPWhiteList> {
    return prisma.iPWhiteList.create({ data });
  }

  async findByIp(ipAddress: string): Promise<IPWhiteList | null> {
    return prisma.iPWhiteList.findFirst({ where: { ipAddress, status: RECORD_STATUS.ACTIVE } });
  }

  async findAll(options?: IPWhiteListFindOptions): Promise<{ whitelists: IPWhiteList[]; total: number }> {
    const where = { status: RECORD_STATUS.ACTIVE };
    const [whitelists, total] = await Promise.all([
      prisma.iPWhiteList.findMany({
        where,
        skip: options?.offset,
        take: options?.limit,
        orderBy: { createTime: "desc" },
      }),
      prisma.iPWhiteList.count({ where }),
    ]);
    return { whitelists, total };
  }

  async deleteByIp(ipAddress: string): Promise<boolean> {
    const record = await this.findByIp(ipAddress);
    if (!record) return false;
    await prisma.iPWhiteList.update({ where: { id: record.id }, data: { status: RECORD_STATUS.DELETED } });
    return true;
  }

  async isWhitelisted(ipAddress: string): Promise<boolean> {
    const record = await prisma.iPWhiteList.findFirst({
      where: {
        ipAddress,
        status: RECORD_STATUS.ACTIVE,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    return !!record;
  }
}
