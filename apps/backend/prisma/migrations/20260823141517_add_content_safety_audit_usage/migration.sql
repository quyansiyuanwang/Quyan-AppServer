-- AlterTable
ALTER TABLE `balance_transactions` ADD COLUMN `auditCost` DECIMAL(14, 6) NULL,
    ADD COLUMN `auditDurationMs` INTEGER NULL,
    ADD COLUMN `auditInputTokens` INTEGER NULL,
    ADD COLUMN `auditOutputTokens` INTEGER NULL,
    ADD COLUMN `auditTotalTokens` INTEGER NULL;

-- AlterTable
ALTER TABLE `relay_usages` ADD COLUMN `auditCost` DECIMAL(14, 6) NOT NULL DEFAULT 0,
    ADD COLUMN `auditDurationMs` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `auditInputTokens` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `auditOutputTokens` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `auditTotalTokens` INTEGER NOT NULL DEFAULT 0;
