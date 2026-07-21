-- AlterTable
ALTER TABLE `json_endpoints` ADD COLUMN `accessMode` VARCHAR(30) NULL,
    ADD COLUMN `publicKey` TEXT NULL,
    ADD COLUMN `publicKeyFingerprint` VARCHAR(64) NULL,
    ADD COLUMN `signatureAlgorithm` VARCHAR(30) NULL;
