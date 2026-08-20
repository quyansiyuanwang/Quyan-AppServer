-- AlterTable
ALTER TABLE `agent_workspaces` ADD COLUMN `machineId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `agent_runtime_machines` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `runtime` VARCHAR(40) NOT NULL DEFAULT 'rootless-docker',
    `runtimeStatus` VARCHAR(30) NOT NULL DEFAULT 'pending',
    `registrationHash` CHAR(64) NOT NULL,
    `agentId` VARCHAR(120) NULL,
    `capabilities` JSON NOT NULL,
    `lastHeartbeatAt` DATETIME(3) NULL,
    `lastError` VARCHAR(1000) NULL,

    UNIQUE INDEX `agent_runtime_machines_registrationHash_key`(`registrationHash`),
    UNIQUE INDEX `agent_runtime_machines_agentId_key`(`agentId`),
    INDEX `agent_runtime_machines_userId_status_idx`(`userId`, `status`),
    INDEX `agent_runtime_machines_userId_runtimeStatus_idx`(`userId`, `runtimeStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `agent_workspaces_machineId_idx` ON `agent_workspaces`(`machineId`);

-- AddForeignKey
ALTER TABLE `agent_workspaces` ADD CONSTRAINT `agent_workspaces_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `agent_runtime_machines`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_runtime_machines` ADD CONSTRAINT `agent_runtime_machines_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
