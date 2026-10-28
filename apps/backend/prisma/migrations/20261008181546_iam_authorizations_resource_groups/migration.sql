-- CreateTable
CREATE TABLE `ram_authorizations` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `accountOwnerId` VARCHAR(191) NOT NULL,
    `principalType` VARCHAR(20) NOT NULL,
    `principalId` VARCHAR(128) NOT NULL,
    `policyId` VARCHAR(191) NOT NULL,
    `scopeType` VARCHAR(20) NOT NULL,
    `scopeResourceId` VARCHAR(128) NULL,
    `scopeArn` VARCHAR(512) NULL,
    `scopeKey` VARCHAR(128) NOT NULL,
    `description` VARCHAR(500) NULL,
    `createdBy` VARCHAR(128) NOT NULL,

    INDEX `ram_authorizations_accountOwnerId_principalType_principalId__idx`(`accountOwnerId`, `principalType`, `principalId`, `status`),
    INDEX `ram_authorizations_policyId_status_idx`(`policyId`, `status`),
    INDEX `ram_authorizations_scopeType_scopeResourceId_idx`(`scopeType`, `scopeResourceId`),
    UNIQUE INDEX `ram_authorizations_accountOwnerId_principalType_principalId__key`(`accountOwnerId`, `principalType`, `principalId`, `policyId`, `scopeKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ram_resource_groups` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `accountOwnerId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `description` VARCHAR(500) NULL,

    INDEX `ram_resource_groups_accountOwnerId_status_idx`(`accountOwnerId`, `status`),
    UNIQUE INDEX `ram_resource_groups_accountOwnerId_name_key`(`accountOwnerId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ram_resource_group_members` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `accountOwnerId` VARCHAR(191) NOT NULL,
    `resourceGroupId` VARCHAR(191) NOT NULL,
    `resourceArn` VARCHAR(512) NOT NULL,
    `service` VARCHAR(64) NOT NULL,
    `resourceType` VARCHAR(128) NOT NULL,
    `resourceId` VARCHAR(256) NOT NULL,

    INDEX `ram_resource_group_members_accountOwnerId_resourceGroupId_st_idx`(`accountOwnerId`, `resourceGroupId`, `status`),
    INDEX `ram_resource_group_members_resourceArn_idx`(`resourceArn`),
    UNIQUE INDEX `ram_resource_group_members_resourceGroupId_resourceArn_key`(`resourceGroupId`, `resourceArn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ram_authorizations` ADD CONSTRAINT `ram_authorizations_accountOwnerId_fkey` FOREIGN KEY (`accountOwnerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ram_authorizations` ADD CONSTRAINT `ram_authorizations_policyId_fkey` FOREIGN KEY (`policyId`) REFERENCES `ram_policies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ram_resource_groups` ADD CONSTRAINT `ram_resource_groups_accountOwnerId_fkey` FOREIGN KEY (`accountOwnerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ram_resource_group_members` ADD CONSTRAINT `ram_resource_group_members_resourceGroupId_fkey` FOREIGN KEY (`resourceGroupId`) REFERENCES `ram_resource_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
