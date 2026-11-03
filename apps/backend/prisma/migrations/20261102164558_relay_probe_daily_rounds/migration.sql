-- CreateTable
CREATE TABLE `relay_probe_daily_schedules` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `actorUserId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
    `minuteOfDay` INTEGER NOT NULL DEFAULT 180,
    `nextRunAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `relay_probe_daily_schedules_actorUserId_key`(`actorUserId`),
    INDEX `relay_probe_daily_schedules_status_enabled_nextRunAt_idx`(`status`, `enabled`, `nextRunAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `relay_probe_rounds` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `scheduleId` VARCHAR(191) NOT NULL,
    `scheduleVersion` INTEGER NOT NULL,
    `actorUserId` VARCHAR(191) NOT NULL,
    `scheduledFor` DATETIME(3) NOT NULL,
    `state` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `leaseOwner` VARCHAR(100) NULL,
    `leaseExpiresAt` DATETIME(3) NULL,
    `targetCount` INTEGER NOT NULL DEFAULT 0,

    INDEX `relay_probe_rounds_state_leaseExpiresAt_idx`(`state`, `leaseExpiresAt`),
    INDEX `relay_probe_rounds_actorUserId_createTime_idx`(`actorUserId`, `createTime`),
    UNIQUE INDEX `relay_probe_rounds_scheduleId_scheduledFor_key`(`scheduleId`, `scheduledFor`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `relay_probe_round_targets` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `roundId` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `memberChannelId` VARCHAR(191) NOT NULL DEFAULT '',
    `channelName` VARCHAR(100) NOT NULL,
    `memberChannelName` VARCHAR(100) NULL,
    `profileId` VARCHAR(191) NOT NULL,
    `profileUpdatedAt` DATETIME(3) NOT NULL,
    `targetConfigId` VARCHAR(191) NULL,
    `targetUpdatedAt` DATETIME(3) NULL,
    `accountId` VARCHAR(191) NULL,
    `accountRevision` VARCHAR(64) NULL,
    `runId` VARCHAR(191) NULL,
    `state` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `errorStage` VARCHAR(40) NULL,
    `errorCode` VARCHAR(100) NULL,
    `report` JSON NULL,

    UNIQUE INDEX `relay_probe_round_targets_runId_key`(`runId`),
    INDEX `relay_probe_round_targets_roundId_state_idx`(`roundId`, `state`),
    UNIQUE INDEX `relay_probe_round_targets_roundId_channelId_memberChannelId_key`(`roundId`, `channelId`, `memberChannelId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `relay_probe_round_notifications` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `roundId` VARCHAR(191) NOT NULL,
    `state` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leaseOwner` VARCHAR(100) NULL,
    `leaseExpiresAt` DATETIME(3) NULL,
    `lastErrorCode` VARCHAR(100) NULL,
    `inboxItemId` VARCHAR(191) NULL,

    UNIQUE INDEX `relay_probe_round_notifications_roundId_key`(`roundId`),
    INDEX `relay_probe_round_notifications_state_nextAttemptAt_leaseExp_idx`(`state`, `nextAttemptAt`, `leaseExpiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `relay_probe_rounds` ADD CONSTRAINT `relay_probe_rounds_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `relay_probe_daily_schedules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_probe_round_targets` ADD CONSTRAINT `relay_probe_round_targets_roundId_fkey` FOREIGN KEY (`roundId`) REFERENCES `relay_probe_rounds`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_probe_round_targets` ADD CONSTRAINT `relay_probe_round_targets_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `relay_channel_probe_runs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_probe_round_notifications` ADD CONSTRAINT `relay_probe_round_notifications_roundId_fkey` FOREIGN KEY (`roundId`) REFERENCES `relay_probe_rounds`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
