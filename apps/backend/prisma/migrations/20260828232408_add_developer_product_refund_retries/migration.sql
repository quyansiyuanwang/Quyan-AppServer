-- CreateTable
CREATE TABLE `developer_product_refund_retries` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `usageId` VARCHAR(191) NOT NULL,
    `accountOwnerId` VARCHAR(191) NOT NULL,
    `chargeAmount` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastError` TEXT NULL,
    `completedAt` DATETIME(3) NULL,

    UNIQUE INDEX `developer_product_refund_retries_usageId_key`(`usageId`),
    INDEX `developer_product_refund_retries_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `agent_approvals_stepId_idx` ON `agent_approvals`(`stepId`);

-- CreateIndex
CREATE INDEX `content_safety_user_configs_userId_idx` ON `content_safety_user_configs`(`userId`);

-- CreateIndex
CREATE INDEX `developer_product_instances_backingProjectId_idx` ON `developer_product_instances`(`backingProjectId`);

-- CreateIndex
CREATE INDEX `mcp_credentials_serverId_idx` ON `mcp_credentials`(`serverId`);

-- CreateIndex
CREATE INDEX `relay_channel_probe_profiles_relayChannelId_idx` ON `relay_channel_probe_profiles`(`relayChannelId`);

-- CreateIndex
CREATE INDEX `remote_terminal_entitlement_tokens_entitlementId_idx` ON `remote_terminal_entitlement_tokens`(`entitlementId`);

-- RenameIndex
ALTER TABLE `agent_approvals` RENAME INDEX `agent_approvals_decidedBy_fkey` TO `agent_approvals_decidedBy_idx`;

-- RenameIndex
ALTER TABLE `agent_tasks` RENAME INDEX `agent_tasks_conversationId_fkey` TO `agent_tasks_conversationId_idx`;

-- RenameIndex
ALTER TABLE `agent_tasks` RENAME INDEX `agent_tasks_relayTokenId_fkey` TO `agent_tasks_relayTokenId_idx`;

-- RenameIndex
ALTER TABLE `archive_artifacts` RENAME INDEX `archive_artifacts_lifecycleRunId_fkey` TO `archive_artifacts_lifecycleRunId_idx`;

-- RenameIndex
ALTER TABLE `data_lifecycle_runs` RENAME INDEX `data_lifecycle_runs_policyId_fkey` TO `data_lifecycle_runs_policyId_idx`;

-- RenameIndex
ALTER TABLE `developer_push_deliveries` RENAME INDEX `developer_push_deliveries_channelId_fkey` TO `developer_push_deliveries_channelId_idx`;

-- RenameIndex
ALTER TABLE `relay_channel_change_requests` RENAME INDEX `relay_channel_change_requests_reviewedByUserId_fkey` TO `relay_channel_change_requests_reviewedByUserId_idx`;

-- RenameIndex
ALTER TABLE `relay_channels` RENAME INDEX `relay_channels_reviewedByUserId_fkey` TO `relay_channels_reviewedByUserId_idx`;
