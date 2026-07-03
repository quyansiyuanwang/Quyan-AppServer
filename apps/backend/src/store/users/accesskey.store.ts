import type { AccessKey } from "@prisma/client";

export interface AccessKeyCreateInput {
  userId: string;
  key: string;
  name?: string;
  expiresAt?: Date;
}

export type AccessKeyUpdateInput = Partial<AccessKey>;

export interface AccessKeyStore {
  create(data: AccessKeyCreateInput): Promise<AccessKey>;
  findByKey(key: string): Promise<AccessKey | null>;
  findById(id: string): Promise<AccessKey | null>;
  findByUserId(userId: string): Promise<AccessKey[]>;
  update(id: string, data: AccessKeyUpdateInput): Promise<AccessKey>;
  delete(id: string): Promise<AccessKey>;
}
