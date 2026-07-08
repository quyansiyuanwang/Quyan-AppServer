-- AlterTable
ALTER TABLE `relay_token_failover_configs` ADD COLUMN `failbackCooldownMinutes` INTEGER NOT NULL DEFAULT 0;
