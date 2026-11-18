import { Prisma, type AccessKey } from "@prisma/client";
import { prisma } from "@/config/database";
import type { AccessKeyCreateInput, AccessKeyStore, AccessKeyUpdateInput } from "./accesskey.store";
import { MANAGED_STATUS } from "@/constant/status";
import { ConflictError } from "@/util/errors";
import { findUniquePlaintextCredential, keyCredentialWhere, plaintextCredentialValues } from "../plaintext-credential";

export async function assertAccessKeyAvailable(tx: Prisma.TransactionClient, key: string) {
  const values = plaintextCredentialValues(key, "accessKey");
  if (!values.length || (await tx.accessKey.findFirst({ where: keyCredentialWhere(values), select: { id: true } })))
    throw new ConflictError("Access key unavailable", undefined, { messageKey: "errors.conflict" });
}

export class AccessKeyRepository implements AccessKeyStore {
  private static instance: AccessKeyRepository;

  public static getInstance(): AccessKeyRepository {
    if (!AccessKeyRepository.instance) AccessKeyRepository.instance = new AccessKeyRepository();

    return AccessKeyRepository.instance;
  }

  async create(data: AccessKeyCreateInput): Promise<AccessKey> {
    return prisma.$transaction(
      async (tx) => {
        await assertAccessKeyAvailable(tx, data.key);
        return tx.accessKey.create({ data });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async findByKey(key: string): Promise<AccessKey | null> {
    const values = plaintextCredentialValues(key, "accessKey");
    if (!values.length) return null;
    const rows = await prisma.accessKey.findMany({ where: keyCredentialWhere(values) });
    return findUniquePlaintextCredential(rows, values, (row) => [row.key, row.legacyKey]);
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

  async delete(id: string, userId: string): Promise<AccessKey> {
    return prisma.accessKey.update({
      where: { id, userId, status: MANAGED_STATUS.ENABLED },
      data: { status: MANAGED_STATUS.DELETED },
    });
  }
}
