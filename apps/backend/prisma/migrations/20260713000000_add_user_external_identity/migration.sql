-- CreateTable
CREATE TABLE `user_external_identities` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(50) NOT NULL,
    `providerUserId` VARCHAR(191) NOT NULL,
    `providerUnionId` VARCHAR(191) NULL,
    `providerUsername` VARCHAR(191) NULL,
    `providerEmail` VARCHAR(191) NULL,
    `avatarUrl` VARCHAR(500) NULL,
    `profileRaw` JSON NULL,
    `accessToken` TEXT NULL,
    `refreshToken` TEXT NULL,
    `scope` VARCHAR(500) NULL,
    `linkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastLoginAt` DATETIME(3) NULL,
    `lastSyncedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,

    INDEX `user_external_identities_userId_idx`(`userId`),
    INDEX `user_external_identities_provider_idx`(`provider`),
    INDEX `user_external_identities_provider_status_idx`(`provider`, `status`),
    UNIQUE INDEX `user_external_identities_provider_providerUserId_key`(`provider`, `providerUserId`),
    UNIQUE INDEX `user_external_identities_provider_providerUnionId_key`(`provider`, `providerUnionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_external_identities` ADD CONSTRAINT `user_external_identities_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

