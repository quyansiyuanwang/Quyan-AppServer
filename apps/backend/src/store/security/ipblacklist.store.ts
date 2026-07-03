import type { IPBlackList } from "@prisma/client";

export type { IPBlackList };

export interface IPBlackListCreateInput {
  ipAddress: string;
  ExpireTime?: Date;
  reason?: string;
  bannedBy?: string;
  banType: string;
  banLevel: number;
}

export interface IPBlackListFindOptions {
  limit?: number;
  offset?: number;
  includeExpired?: boolean;
}

export interface IPBlackListStore {
  create(data: IPBlackListCreateInput): Promise<IPBlackList>;
  findByIp(ipAddress: string): Promise<IPBlackList | null>;
  findByIpAnyStatus(ipAddress: string): Promise<IPBlackList | null>;
  findAll(options?: IPBlackListFindOptions): Promise<{ blacklists: IPBlackList[]; total: number }>;
  update(id: string, data: Partial<IPBlackList>): Promise<IPBlackList>;
  delete(id: string): Promise<IPBlackList>;
  deleteByIp(ipAddress: string): Promise<boolean>;
  isBlacklisted(ipAddress: string): Promise<boolean>;
}
