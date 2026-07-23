-- CreateTable
CREATE TABLE `developer_push_requests` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(100) NOT NULL,
    `requestStatus` VARCHAR(20) NOT NULL DEFAULT 'pending',

    INDEX `developer_push_requests_projectId_createTime_idx`(`projectId`, `createTime`),
    UNIQUE INDEX `developer_push_requests_projectId_idempotencyKey_key`(`projectId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `developer_push_requests` ADD CONSTRAINT `developer_push_requests_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `developer_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
