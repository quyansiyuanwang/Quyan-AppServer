import OSS from "ali-oss";
import type { ObjectStorageBucketConfig } from "@/config/env/infrastructure";
import { BadRequestError } from "@/util/errors";

export type ObjectStorageBucketName = "archive" | "staging";

export function createObjectStorageClient(config: ObjectStorageBucketConfig, bucket: ObjectStorageBucketName): OSS {
  if (!config.enabled) {
    const label = bucket === "staging" ? "Import staging OSS" : "Archive OSS";
    throw new BadRequestError(`${label} is not configured`);
  }
  return new OSS({
    region: config.region,
    endpoint: config.endpoint,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    secure: true,
  });
}
