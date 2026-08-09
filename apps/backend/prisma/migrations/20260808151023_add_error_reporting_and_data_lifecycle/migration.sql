-- CreateTable
CREATE TABLE `error_groups` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `fingerprint` VARCHAR(128) NOT NULL,
    `source` VARCHAR(20) NOT NULL,
    `errorType` VARCHAR(120) NOT NULL,
    `message` TEXT NOT NULL,
    `route` VARCHAR(1024) NULL,
    `severity` VARCHAR(20) NOT NULL DEFAULT 'error',
    `resolutionStatus` VARCHAR(20) NOT NULL DEFAULT 'open',
    `firstSeenAt` DATETIME(3) NOT NULL,
    `lastSeenAt` DATETIME(3) NOT NULL,
    `occurrenceCount` INTEGER NOT NULL DEFAULT 1,
    `affectedUserCount` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `error_groups_fingerprint_key`(`fingerprint`),
    INDEX `error_groups_resolutionStatus_lastSeenAt_idx`(`resolutionStatus`, `lastSeenAt`),
    INDEX `error_groups_source_lastSeenAt_idx`(`source`, `lastSeenAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `error_occurrences` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `errorGroupId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `requestId` VARCHAR(128) NULL,
    `source` VARCHAR(20) NOT NULL,
    `route` VARCHAR(1024) NULL,
    `httpMethod` VARCHAR(12) NULL,
    `httpStatus` INTEGER NULL,
    `clientVersion` VARCHAR(128) NULL,
    `userAgent` TEXT NULL,
    `ipAddress` VARCHAR(128) NULL,
    `stack` TEXT NULL,
    `context` JSON NULL,

    INDEX `error_occurrences_errorGroupId_createTime_idx`(`errorGroupId`, `createTime`),
    INDEX `error_occurrences_userId_createTime_idx`(`userId`, `createTime`),
    INDEX `error_occurrences_requestId_idx`(`requestId`),
    INDEX `error_occurrences_createTime_idx`(`createTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `data_lifecycle_policies` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `dataset` VARCHAR(80) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `hotRetentionDays` INTEGER NOT NULL,
    `archiveRetentionDays` INTEGER NOT NULL DEFAULT 365,
    `lastRunAt` DATETIME(3) NULL,

    UNIQUE INDEX `data_lifecycle_policies_dataset_key`(`dataset`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `data_lifecycle_runs` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `policyId` VARCHAR(191) NULL,
    `dataset` VARCHAR(80) NOT NULL,
    `runType` VARCHAR(20) NOT NULL,
    `runStatus` VARCHAR(20) NOT NULL DEFAULT 'running',
    `cutoffAt` DATETIME(3) NOT NULL,
    `candidateCount` INTEGER NOT NULL DEFAULT 0,
    `archivedCount` INTEGER NOT NULL DEFAULT 0,
    `deletedCount` INTEGER NOT NULL DEFAULT 0,
    `errorMessage` TEXT NULL,
    `startedByUserId` VARCHAR(191) NULL,
    `completedAt` DATETIME(3) NULL,

    INDEX `data_lifecycle_runs_dataset_createTime_idx`(`dataset`, `createTime`),
    INDEX `data_lifecycle_runs_runStatus_createTime_idx`(`runStatus`, `createTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `archive_artifacts` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `lifecycleRunId` VARCHAR(191) NOT NULL,
    `dataset` VARCHAR(80) NOT NULL,
    `objectKey` VARCHAR(512) NOT NULL,
    `sha256` VARCHAR(64) NOT NULL,
    `recordCount` INTEGER NOT NULL,
    `byteSize` BIGINT NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `archive_artifacts_objectKey_key`(`objectKey`),
    INDEX `archive_artifacts_dataset_expiresAt_idx`(`dataset`, `expiresAt`),
    INDEX `archive_artifacts_expiresAt_deletedAt_idx`(`expiresAt`, `deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `error_occurrences` ADD CONSTRAINT `error_occurrences_errorGroupId_fkey` FOREIGN KEY (`errorGroupId`) REFERENCES `error_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `data_lifecycle_runs` ADD CONSTRAINT `data_lifecycle_runs_policyId_fkey` FOREIGN KEY (`policyId`) REFERENCES `data_lifecycle_policies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `archive_artifacts` ADD CONSTRAINT `archive_artifacts_lifecycleRunId_fkey` FOREIGN KEY (`lifecycleRunId`) REFERENCES `data_lifecycle_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

