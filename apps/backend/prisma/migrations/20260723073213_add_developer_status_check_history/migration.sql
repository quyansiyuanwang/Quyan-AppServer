-- CreateTable
CREATE TABLE `developer_status_checks` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `monitorId` VARCHAR(191) NOT NULL,
    `checkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `checkStatus` VARCHAR(20) NOT NULL,
    `statusCode` INTEGER NULL,
    `latencyMs` INTEGER NOT NULL,
    `errorMessage` VARCHAR(500) NULL,

    INDEX `developer_status_checks_monitorId_checkedAt_idx`(`monitorId`, `checkedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `developer_status_checks` ADD CONSTRAINT `developer_status_checks_monitorId_fkey` FOREIGN KEY (`monitorId`) REFERENCES `developer_status_monitors`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
