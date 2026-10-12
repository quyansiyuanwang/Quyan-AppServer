import { prisma } from "@/config/database";
import { Prisma, type IPWhiteList } from "@prisma/client";
import type { IPWhiteListCreateInput, IPWhiteListFindOptions, IPWhiteListStore } from "./ipwhitelist.store";
import { ConflictError } from "@/util/errors";
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
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(Prisma.sql`SELECT id FROM ip_white_lists WHERE ipAddress = ${data.ipAddress} FOR UPDATE`);
          const existing = await tx.iPWhiteList.findUnique({ where: { ipAddress: data.ipAddress } });
          if (existing && existing.status !== RECORD_STATUS.DELETED)
            throw new ConflictError("IP whitelist entry already exists", undefined, { messageKey: "errors.conflict" });
          return existing
            ? tx.iPWhiteList.update({
                where: { id: existing.id },
                data: { ...data, status: RECORD_STATUS.ACTIVE, expiresAt: data.expiresAt ?? null },
              })
            : tx.iPWhiteList.create({ data });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new ConflictError("IP whitelist context changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
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
