-- AlterTable
ALTER TABLE `balance_transactions` ADD COLUMN `contextMultiplier` DECIMAL(10, 6) NULL,
    ADD COLUMN `contextRuleName` VARCHAR(100) NULL,
    ADD COLUMN `contextTokens` INTEGER NULL;

-- AlterTable
ALTER TABLE `relay_channels` ADD COLUMN `contextLengthMultipliers` JSON NULL;
