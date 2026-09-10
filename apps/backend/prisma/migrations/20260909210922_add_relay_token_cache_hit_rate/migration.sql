-- AlterTable
ALTER TABLE `relay_token_failover_configs` ADD COLUMN `cacheHitRateMinSamples` INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN `minCacheHitRate` DECIMAL(5, 4) NULL,
    ADD COLUMN `cacheHitRateWindowHours` INTEGER NOT NULL DEFAULT 168;
