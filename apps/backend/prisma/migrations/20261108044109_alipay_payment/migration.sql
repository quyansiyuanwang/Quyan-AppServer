-- CreateTable
CREATE TABLE `alipay_profiles` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `appId` VARCHAR(32) NOT NULL,
    `sellerId` VARCHAR(32) NOT NULL,
    `sandbox` BOOLEAN NOT NULL DEFAULT true,
    `encryptedCredentials` TEXT NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_orders` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `profileId` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(64) NOT NULL,
    `outTradeNo` VARCHAR(64) NOT NULL,
    `tradeNo` VARCHAR(64) NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `rechargeRatio` DECIMAL(14, 4) NOT NULL,
    `creditAmount` DECIMAL(10, 4) NOT NULL,
    `refundedAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `state` VARCHAR(24) NOT NULL DEFAULT 'pending',
    `providerState` VARCHAR(32) NULL,
    `paidAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `nextQueryAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `queryAttempts` INTEGER NOT NULL DEFAULT 0,
    `notifyUrl` TEXT NOT NULL,
    `returnUrl` TEXT NOT NULL,

    UNIQUE INDEX `payment_orders_outTradeNo_key`(`outTradeNo`),
    UNIQUE INDEX `payment_orders_tradeNo_key`(`tradeNo`),
    INDEX `payment_orders_state_nextQueryAt_idx`(`state`, `nextQueryAt`),
    INDEX `payment_orders_userId_createTime_idx`(`userId`, `createTime`),
    UNIQUE INDEX `payment_orders_userId_requestId_key`(`userId`, `requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_refunds` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `outRequestNo` VARCHAR(64) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `creditAmount` DECIMAL(10, 4) NOT NULL,
    `state` VARCHAR(24) NOT NULL DEFAULT 'processing',
    `reason` VARCHAR(200) NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `failureCode` VARCHAR(80) NULL,
    `completedAt` DATETIME(3) NULL,
    `nextQueryAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `queryAttempts` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `payment_refunds_outRequestNo_key`(`outRequestNo`),
    INDEX `payment_refunds_state_nextQueryAt_idx`(`state`, `nextQueryAt`),
    INDEX `payment_refunds_orderId_createTime_idx`(`orderId`, `createTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `payment_orders` ADD CONSTRAINT `payment_orders_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_orders` ADD CONSTRAINT `payment_orders_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `alipay_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_refunds` ADD CONSTRAINT `payment_refunds_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `payment_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
