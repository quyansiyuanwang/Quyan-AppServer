-- AlterTable
ALTER TABLE `relay_channel_probe_profiles` ADD COLUMN `cacheMode` VARCHAR(20) NOT NULL DEFAULT 'cache-bust',
    ADD COLUMN `probeEndpoint` VARCHAR(40) NOT NULL DEFAULT 'openai-chat-completions',
    ADD COLUMN `sampleCount` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `relay_channel_probe_runs` ADD COLUMN `cacheMode` VARCHAR(20) NOT NULL DEFAULT 'cache-bust',
    ADD COLUMN `probeEndpoint` VARCHAR(40) NOT NULL DEFAULT 'openai-chat-completions',
    ADD COLUMN `sampleAcceptedCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `sampleCount` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `sampleDiscardedCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `sampleSucceededCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `samples` JSON NULL,
    ADD COLUMN `warmupCacheCreationTokens` INTEGER NULL,
    ADD COLUMN `warmupCacheReadTokens` INTEGER NULL,
    ADD COLUMN `warmupRequestCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `warmupUsage` JSON NULL;
