-- AlterTable
ALTER TABLE `developer_short_link_clicks` ADD COLUMN `ipAddress` VARCHAR(45) NULL;

-- CreateIndex
CREATE INDEX `developer_short_link_clicks_shortLinkId_ipAddress_idx` ON `developer_short_link_clicks`(`shortLinkId`, `ipAddress`);
