-- CreateTable
CREATE TABLE `content_safety_rules` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `pattern` TEXT NOT NULL,
    `direction` VARCHAR(20) NOT NULL,
    `action` VARCHAR(20) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `priority` INTEGER NOT NULL DEFAULT 100,
    `source` VARCHAR(20) NOT NULL DEFAULT 'custom',
    `version` VARCHAR(40) NULL,

    INDEX `content_safety_rules_status_enabled_direction_priority_idx`(`status`, `enabled`, `direction`, `priority`),
    INDEX `content_safety_rules_source_version_idx`(`source`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_safety_incidents` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `relayTokenId` VARCHAR(191) NULL,
    `requestId` VARCHAR(100) NULL,
    `direction` VARCHAR(20) NOT NULL,
    `action` VARCHAR(20) NOT NULL,
    `source` VARCHAR(20) NOT NULL,
    `ruleId` VARCHAR(191) NULL,
    `model` VARCHAR(160) NULL,
    `channelId` VARCHAR(100) NULL,
    `statusCode` INTEGER NULL,
    `auditModel` VARCHAR(160) NULL,
    `auditInputTokens` INTEGER NOT NULL DEFAULT 0,
    `auditOutputTokens` INTEGER NOT NULL DEFAULT 0,
    `auditTotalTokens` INTEGER NOT NULL DEFAULT 0,
    `auditCost` DECIMAL(14, 6) NOT NULL DEFAULT 0,
    `auditDurationMs` INTEGER NOT NULL DEFAULT 0,
    `replaced` BOOLEAN NOT NULL DEFAULT false,
    `blocked` BOOLEAN NOT NULL DEFAULT false,

    INDEX `content_safety_incidents_userId_createTime_idx`(`userId`, `createTime`),
    INDEX `content_safety_incidents_direction_createTime_idx`(`direction`, `createTime`),
    INDEX `content_safety_incidents_ruleId_idx`(`ruleId`),
    INDEX `content_safety_incidents_relayTokenId_requestId_idx`(`relayTokenId`, `requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `content_safety_incidents` ADD CONSTRAINT `content_safety_incidents_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `content_safety_incidents` ADD CONSTRAINT `content_safety_incidents_ruleId_fkey` FOREIGN KEY (`ruleId`) REFERENCES `content_safety_rules`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
