-- AlterTable
ALTER TABLE `ram_policies` ADD COLUMN `defaultVersionId` VARCHAR(191) NULL,
    ADD COLUMN `documentFormat` VARCHAR(20) NOT NULL DEFAULT 'legacy',
    ADD COLUMN `policyKind` VARCHAR(20) NOT NULL DEFAULT 'identity',
    ADD COLUMN `validationState` VARCHAR(20) NOT NULL DEFAULT 'legacy';

-- CreateTable
CREATE TABLE `ram_policy_versions` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `policyId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `document` JSON NOT NULL,
    `documentHash` VARCHAR(64) NOT NULL,
    `validationState` VARCHAR(20) NOT NULL DEFAULT 'valid',
    `createdBy` VARCHAR(191) NOT NULL,

    INDEX `ram_policy_versions_policyId_status_idx`(`policyId`, `status`),
    UNIQUE INDEX `ram_policy_versions_policyId_version_key`(`policyId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ram_policies` ADD CONSTRAINT `ram_policies_defaultVersionId_fkey` FOREIGN KEY (`defaultVersionId`) REFERENCES `ram_policy_versions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ram_policy_versions` ADD CONSTRAINT `ram_policy_versions_policyId_fkey` FOREIGN KEY (`policyId`) REFERENCES `ram_policies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
