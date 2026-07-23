-- AlterTable
ALTER TABLE `developer_verifications` ADD COLUMN `sourceIpHash` CHAR(64) NULL;

-- CreateIndex
CREATE INDEX `developer_verifications_projectId_sourceIpHash_createTime_idx` ON `developer_verifications`(`projectId`, `sourceIpHash`, `createTime`);
