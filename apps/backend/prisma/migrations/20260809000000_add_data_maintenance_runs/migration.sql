-- CreateTable
CREATE TABLE `data_maintenance_runs` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `operation` VARCHAR(20) NOT NULL,
    `dataset` VARCHAR(80) NULL,
    `tableNames` JSON NULL,
    `runStatus` VARCHAR(20) NOT NULL DEFAULT 'queued',
    `startedByUserId` VARCHAR(191) NULL,
    `requestId` VARCHAR(128) NULL,
    `tempObjectKey` VARCHAR(512) NULL,
    `totalCount` INTEGER NOT NULL DEFAULT 0,
    `insertedCount` INTEGER NOT NULL DEFAULT 0,
    `skippedCount` INTEGER NOT NULL DEFAULT 0,
    `invalidCount` INTEGER NOT NULL DEFAULT 0,
    `failedCount` INTEGER NOT NULL DEFAULT 0,
    `errorMessage` TEXT NULL,
    `result` JSON NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,

    INDEX `data_maintenance_runs_runStatus_createTime_idx`(`runStatus`, `createTime`),
    INDEX `data_maintenance_runs_operation_createTime_idx`(`operation`, `createTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
