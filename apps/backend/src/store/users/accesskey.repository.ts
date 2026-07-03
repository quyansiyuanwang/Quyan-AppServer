import { AccessKey } from "@prisma/client";
import { prisma } from "@/config/database";
import type { AccessKeyCreateInput, AccessKeyStore, AccessKeyUpdateInput } from "./accesskey.store";
import { MANAGED_STATUS } from "@/constant/status";

export class AccessKeyRepository implements AccessKeyStore {
  private static instance: AccessKeyRepository;

  public static getInstance(): AccessKeyRepository {
    if (!AccessKeyRepository.instance) AccessKeyRepository.instance = new AccessKeyRepository();

    return AccessKeyRepository.instance;
  }

  async create(data: AccessKeyCreateInput): Promise<AccessKey> {
    return prisma.accessKey.create({ data });
  }

  async findByKey(key: string): Promise<AccessKey | null> {
    return prisma.accessKey.findUnique({ where: { key } });
  }

  async findById(id: string): Promise<AccessKey | null> {
    return prisma.accessKey.findUnique({ where: { id } });
  }

  async findByUserId(userId: string): Promise<AccessKey[]> {
    return prisma.accessKey.findMany({
      where: { userId, status: MANAGED_STATUS.ENABLED },
      orderBy: { createTime: "desc" },
    });
  }

  async update(id: string, data: AccessKeyUpdateInput): Promise<AccessKey> {
    return prisma.accessKey.update({ where: { id }, data });
  }

  async delete(id: string): Promise<AccessKey> {
    return prisma.accessKey.update({
      where: { id },
      data: { status: MANAGED_STATUS.DELETED },
    });
  }
}
