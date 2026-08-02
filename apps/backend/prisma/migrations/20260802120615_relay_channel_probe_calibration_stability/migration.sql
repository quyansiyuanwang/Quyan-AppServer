-- AlterTable
ALTER TABLE `relay_channel_probe_profiles` ADD COLUMN `balanceSettlementReads` INTEGER NOT NULL DEFAULT 2,
    ADD COLUMN `balanceSettlementTolerance` DECIMAL(18, 6) NOT NULL DEFAULT 0.000001,
    ADD COLUMN `measurementInputTokens` INTEGER NOT NULL DEFAULT 1024,
    MODIFY `sampleCount` INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE `relay_channel_probe_runs` ADD COLUMN `balanceSettlementReads` INTEGER NOT NULL DEFAULT 2,
    ADD COLUMN `balanceSettlementTolerance` DECIMAL(18, 6) NOT NULL DEFAULT 0.000001,
    ADD COLUMN `balanceSnapshots` JSON NULL,
    ADD COLUMN `calibrationStatus` VARCHAR(32) NOT NULL DEFAULT 'pending',
    ADD COLUMN `measurementInputTokens` INTEGER NOT NULL DEFAULT 1024,
    ADD COLUMN `pricingFingerprint` VARCHAR(64) NULL,
    ADD COLUMN `pricingSnapshot` JSON NULL,
    MODIFY `sampleCount` INTEGER NOT NULL DEFAULT 3;
