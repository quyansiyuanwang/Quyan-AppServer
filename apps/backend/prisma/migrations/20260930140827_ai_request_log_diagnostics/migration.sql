-- AlterTable
ALTER TABLE `ai_request_logs` ADD COLUMN `attempts` JSON NULL,
    ADD COLUMN `attemptsTruncated` BOOLEAN NULL,
    ADD COLUMN `authenticationState` VARCHAR(20) NULL,
    ADD COLUMN `bodyOmissionReason` VARCHAR(24) NULL,
    ADD COLUMN `errorCode` VARCHAR(100) NULL,
    ADD COLUMN `errorSummary` VARCHAR(500) NULL,
    ADD COLUMN `failureStage` VARCHAR(24) NULL,
    ADD COLUMN `isStreaming` BOOLEAN NULL,
    ADD COLUMN `outcome` VARCHAR(20) NULL;

-- CreateIndex
CREATE INDEX `ai_request_logs_outcome_createTime_idx` ON `ai_request_logs`(`outcome`, `createTime`);
