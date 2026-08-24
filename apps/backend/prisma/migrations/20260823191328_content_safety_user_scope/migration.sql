-- AlterTable
ALTER TABLE `content_safety_rules` ADD COLUMN `ownerUserId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `relay_tokens` ADD COLUMN `contentSafetyConfig` JSON NULL;

-- CreateTable
CREATE TABLE `content_safety_user_configs` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `requestEnabled` BOOLEAN NULL,
    `requestAction` VARCHAR(20) NULL,
    `requestAiEnabled` BOOLEAN NULL,
    `responseEnabled` BOOLEAN NULL,
    `responseAction` VARCHAR(20) NULL,
    `responseAiEnabled` BOOLEAN NULL,

    UNIQUE INDEX `content_safety_user_configs_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_safety_rule_user_overrides` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `ruleId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL,

    INDEX `content_safety_rule_user_overrides_userId_status_idx`(`userId`, `status`),
    INDEX `content_safety_rule_user_overrides_ruleId_status_idx`(`ruleId`, `status`),
    UNIQUE INDEX `content_safety_rule_user_overrides_userId_ruleId_key`(`userId`, `ruleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `content_safety_rules_ownerUserId_status_enabled_direction_pr_idx` ON `content_safety_rules`(`ownerUserId`, `status`, `enabled`, `direction`, `priority`);

-- AddForeignKey
ALTER TABLE `content_safety_rules` ADD CONSTRAINT `content_safety_rules_ownerUserId_fkey` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `content_safety_user_configs` ADD CONSTRAINT `content_safety_user_configs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `content_safety_rule_user_overrides` ADD CONSTRAINT `content_safety_rule_user_overrides_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `content_safety_rule_user_overrides` ADD CONSTRAINT `content_safety_rule_user_overrides_ruleId_fkey` FOREIGN KEY (`ruleId`) REFERENCES `content_safety_rules`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
