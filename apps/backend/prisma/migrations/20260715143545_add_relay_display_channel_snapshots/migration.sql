-- AlterTable
ALTER TABLE `balance_transactions` ADD COLUMN `displayChannelId` VARCHAR(191) NULL,
    ADD COLUMN `displayChannelName` TEXT NULL;

-- AlterTable
ALTER TABLE `monthly_pass_usages` ADD COLUMN `displayChannelId` VARCHAR(191) NULL,
    ADD COLUMN `displayChannelName` TEXT NULL;

-- AlterTable
ALTER TABLE `relay_channel_switch_logs` ADD COLUMN `fromDisplayChannelId` VARCHAR(191) NULL,
    ADD COLUMN `fromDisplayChannelName` TEXT NULL,
    ADD COLUMN `toDisplayChannelId` VARCHAR(191) NULL,
    ADD COLUMN `toDisplayChannelName` TEXT NULL;

-- AlterTable
ALTER TABLE `relay_usages` ADD COLUMN `displayChannelId` VARCHAR(191) NULL,
    ADD COLUMN `displayChannelName` TEXT NULL,
    ADD COLUMN `executionChannelId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `balance_transactions_displayChannelId_idx` ON `balance_transactions`(`displayChannelId`);

-- CreateIndex
CREATE INDEX `monthly_pass_usages_displayChannelId_idx` ON `monthly_pass_usages`(`displayChannelId`);

-- CreateIndex
CREATE INDEX `relay_usages_executionChannelId_idx` ON `relay_usages`(`executionChannelId`);

-- CreateIndex
CREATE INDEX `relay_usages_displayChannelId_idx` ON `relay_usages`(`displayChannelId`);
