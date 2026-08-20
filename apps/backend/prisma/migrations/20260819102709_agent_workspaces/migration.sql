-- CreateTable
CREATE TABLE `agent_workspaces` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `runtime` VARCHAR(40) NOT NULL DEFAULT 'rootless-docker',
    `runtimeStatus` VARCHAR(30) NOT NULL DEFAULT 'provisioning',
    `runtimeAgentId` VARCHAR(120) NULL,
    `runtimeHandle` VARCHAR(200) NULL,
    `policy` JSON NOT NULL,
    `limits` JSON NOT NULL,
    `lastError` VARCHAR(1000) NULL,

    INDEX `agent_workspaces_userId_status_idx`(`userId`, `status`),
    INDEX `agent_workspaces_userId_runtimeStatus_idx`(`userId`, `runtimeStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mcp_servers` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `transport` VARCHAR(30) NOT NULL DEFAULT 'streamable-http',
    `endpoint` VARCHAR(2048) NULL,
    `agentId` VARCHAR(120) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `toolAllowlist` JSON NOT NULL,
    `metadata` JSON NOT NULL,

    INDEX `mcp_servers_userId_status_idx`(`userId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mcp_credentials` (
    `id` VARCHAR(191) NOT NULL,
    `serverId` VARCHAR(191) NOT NULL,
    `ciphertext` TEXT NOT NULL,
    `iv` VARCHAR(100) NOT NULL,
    `authTag` VARCHAR(100) NOT NULL,
    `keyVersion` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,

    UNIQUE INDEX `mcp_credentials_serverId_key`(`serverId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_tasks` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `relayTokenId` VARCHAR(191) NOT NULL,
    `model` VARCHAR(120) NOT NULL,
    `prompt` TEXT NOT NULL,
    `taskStatus` VARCHAR(30) NOT NULL DEFAULT 'queued',
    `maxSteps` INTEGER NOT NULL DEFAULT 30,
    `stepCount` INTEGER NOT NULL DEFAULT 0,
    `budget` DECIMAL(10, 4) NULL,
    `spent` DECIMAL(10, 4) NOT NULL DEFAULT 0,
    `leaseOwner` VARCHAR(120) NULL,
    `leaseExpiresAt` DATETIME(3) NULL,
    `lastError` VARCHAR(2000) NULL,
    `completedAt` DATETIME(3) NULL,

    INDEX `agent_tasks_userId_createTime_idx`(`userId`, `createTime`),
    INDEX `agent_tasks_workspaceId_taskStatus_idx`(`workspaceId`, `taskStatus`),
    INDEX `agent_tasks_taskStatus_leaseExpiresAt_idx`(`taskStatus`, `leaseExpiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_task_steps` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `kind` VARCHAR(30) NOT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'running',
    `toolName` VARCHAR(200) NULL,
    `call` JSON NULL,
    `result` JSON NULL,
    `inputTokens` INTEGER NOT NULL DEFAULT 0,
    `outputTokens` INTEGER NOT NULL DEFAULT 0,
    `error` VARCHAR(2000) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

    INDEX `agent_task_steps_taskId_startedAt_idx`(`taskId`, `startedAt`),
    UNIQUE INDEX `agent_task_steps_taskId_sequence_key`(`taskId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_approvals` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `stepId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `toolCall` JSON NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `decidedBy` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `agent_approvals_stepId_key`(`stepId`),
    INDEX `agent_approvals_taskId_status_idx`(`taskId`, `status`),
    INDEX `agent_approvals_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_artifacts` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `storageKey` VARCHAR(1024) NOT NULL,
    `contentType` VARCHAR(160) NOT NULL,
    `size` INTEGER NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `agent_artifacts_userId_createTime_idx`(`userId`, `createTime`),
    INDEX `agent_artifacts_taskId_idx`(`taskId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_run_events` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `eventType` VARCHAR(40) NOT NULL,
    `payload` JSON NOT NULL,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `agent_run_events_taskId_createTime_idx`(`taskId`, `createTime`),
    UNIQUE INDEX `agent_run_events_taskId_sequence_key`(`taskId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `agent_workspaces` ADD CONSTRAINT `agent_workspaces_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mcp_servers` ADD CONSTRAINT `mcp_servers_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mcp_credentials` ADD CONSTRAINT `mcp_credentials_serverId_fkey` FOREIGN KEY (`serverId`) REFERENCES `mcp_servers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_tasks` ADD CONSTRAINT `agent_tasks_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_tasks` ADD CONSTRAINT `agent_tasks_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `agent_workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_tasks` ADD CONSTRAINT `agent_tasks_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_tasks` ADD CONSTRAINT `agent_tasks_relayTokenId_fkey` FOREIGN KEY (`relayTokenId`) REFERENCES `relay_tokens`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_task_steps` ADD CONSTRAINT `agent_task_steps_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `agent_tasks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_approvals` ADD CONSTRAINT `agent_approvals_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `agent_tasks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_approvals` ADD CONSTRAINT `agent_approvals_stepId_fkey` FOREIGN KEY (`stepId`) REFERENCES `agent_task_steps`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_approvals` ADD CONSTRAINT `agent_approvals_decidedBy_fkey` FOREIGN KEY (`decidedBy`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_artifacts` ADD CONSTRAINT `agent_artifacts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_artifacts` ADD CONSTRAINT `agent_artifacts_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `agent_tasks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_run_events` ADD CONSTRAINT `agent_run_events_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `agent_tasks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
