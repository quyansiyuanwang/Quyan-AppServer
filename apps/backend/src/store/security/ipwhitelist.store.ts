import type { IPWhiteList } from "@prisma/client";

export type { IPWhiteList };

export interface IPWhiteListCreateInput {
  ipAddress: string;
  reason?: string;
  addedBy?: string;
  expiresAt?: Date;
}

export interface IPWhiteListFindOptions {
  limit?: number;
  offset?: number;
}

export interface IPWhiteListStore {
  create(data: IPWhiteListCreateInput): Promise<IPWhiteList>;
  findByIp(ipAddress: string): Promise<IPWhiteList | null>;
  findAll(options?: IPWhiteListFindOptions): Promise<{ whitelists: IPWhiteList[]; total: number }>;
  deleteByIp(ipAddress: string): Promise<boolean>;
  isWhitelisted(ipAddress: string): Promise<boolean>;
}
