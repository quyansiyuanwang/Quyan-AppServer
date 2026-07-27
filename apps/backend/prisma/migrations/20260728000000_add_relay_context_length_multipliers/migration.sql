ALTER TABLE `relay_channels`
  ADD COLUMN `contextLengthMultipliers` JSON NULL;

ALTER TABLE `balance_transactions`
  ADD COLUMN `contextTokens` INTEGER NULL,
  ADD COLUMN `contextMultiplier` DECIMAL(10, 6) NULL,
  ADD COLUMN `contextRuleName` VARCHAR(100) NULL;
