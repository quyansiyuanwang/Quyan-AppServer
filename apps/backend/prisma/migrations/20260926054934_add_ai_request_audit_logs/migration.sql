-- AlterTable
ALTER TABLE `archive_artifacts` MODIFY `expiresAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `data_lifecycle_policies` MODIFY `archiveRetentionDays` INTEGER NULL DEFAULT 365;

-- CreateTable
CREATE TABLE `ai_request_logs` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `requestId` VARCHAR(64) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `username` VARCHAR(191) NULL,
    `relayTokenId` VARCHAR(191) NULL,
    `relayTokenName` VARCHAR(100) NULL,
    `model` VARCHAR(160) NULL,
    `requestFormat` VARCHAR(40) NULL,
    `path` VARCHAR(1024) NOT NULL,
    `method` VARCHAR(12) NOT NULL,
    `statusCode` INTEGER NOT NULL,
    `ipAddress` VARCHAR(128) NOT NULL,
    `userAgent` TEXT NULL,
    `durationMs` INTEGER NOT NULL DEFAULT 0,
    `requestSizeBytes` INTEGER NULL,
    `responseSizeBytes` INTEGER NULL,
    `requestTruncated` BOOLEAN NOT NULL DEFAULT false,
    `responseTruncated` BOOLEAN NOT NULL DEFAULT false,
    `requestBody` JSON NULL,
    `responseBody` JSON NULL,

    UNIQUE INDEX `ai_request_logs_requestId_key`(`requestId`),
    INDEX `ai_request_logs_createTime_idx`(`createTime`),
    INDEX `ai_request_logs_userId_createTime_idx`(`userId`, `createTime`),
    INDEX `ai_request_logs_relayTokenId_createTime_idx`(`relayTokenId`, `createTime`),
    INDEX `ai_request_logs_model_createTime_idx`(`model`, `createTime`),
    INDEX `ai_request_logs_statusCode_createTime_idx`(`statusCode`, `createTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
