-- CreateTable
CREATE TABLE `developer_quota_overrides` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `subjectType` VARCHAR(10) NOT NULL,
    `subjectId` VARCHAR(191) NOT NULL,
    `service` VARCHAR(30) NOT NULL DEFAULT '*',
    `dailyFreeQuota` INTEGER NOT NULL,
    `expiresAt` DATETIME(3) NULL,
    `createdByUserId` VARCHAR(191) NOT NULL,

    INDEX `developer_quota_overrides_subjectType_subjectId_status_expir_idx`(`subjectType`, `subjectId`, `status`, `expiresAt`),
    UNIQUE INDEX `developer_quota_overrides_subjectType_subjectId_service_key`(`subjectType`, `subjectId`, `service`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
