-- CreateTable
CREATE TABLE `support_ai_usage_records` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `model` VARCHAR(160) NOT NULL,
    `inputTokens` INTEGER NOT NULL DEFAULT 0,
    `outputTokens` INTEGER NOT NULL DEFAULT 0,
    `totalTokens` INTEGER NOT NULL DEFAULT 0,
    `estimatedCost` DECIMAL(14, 6) NOT NULL DEFAULT 0,
    `durationMs` INTEGER NULL,

    INDEX `support_ai_usage_records_userId_createTime_idx`(`userId`, `createTime`),
    INDEX `support_ai_usage_records_createTime_idx`(`createTime`),
    INDEX `support_ai_usage_records_model_createTime_idx`(`model`, `createTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `support_ai_usage_records` ADD CONSTRAINT `support_ai_usage_records_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
