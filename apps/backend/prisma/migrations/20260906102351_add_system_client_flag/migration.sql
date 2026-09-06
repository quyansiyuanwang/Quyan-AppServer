-- AlterTable
ALTER TABLE `oauth_clients` ADD COLUMN `isSystemClient` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX `oauth_clients_isSystemClient_status_idx` ON `oauth_clients`(`isSystemClient`, `status`);
