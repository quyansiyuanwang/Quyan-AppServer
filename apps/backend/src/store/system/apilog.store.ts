import type { APILog } from "@prisma/client";

export type APILogWithoutResponse = Omit<APILog, "response" | "responseHeaders">;
export type APILogStatsRow = Pick<APILog, "createTime" | "userID" | "method" | "path" | "statusCode" | "ipAddress">;

export interface CreateAPILogParams {
  requestID: string;
  userID?: string;
  path: string;
  method: string;
  queryParams?: any;
  bodyParams?: any;
  requestHeaders?: any;
  ipAddress: string;
  response?: any;
  responseHeaders?: any;
  statusCode: number;
}

export interface QueryAPILogParams {
  user?: string;
  requestID?: string;
  path?: string;
  ip?: string;
  method?: string | string[];
  statusCode?: number | number[];
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
  search?: string;
}

export interface APILogStore {
  create(params: CreateAPILogParams): Promise<APILog>;
  createMany(paramsArray: CreateAPILogParams[]): Promise<number>;
  query(params: QueryAPILogParams): Promise<{ logs: APILogWithoutResponse[]; total: number }>;
  listForStats(params: QueryAPILogParams): Promise<APILogStatsRow[]>;
  findById(id: string): Promise<APILog | null>;
  deleteOldLogs(daysToKeep?: number): Promise<number>;
}
