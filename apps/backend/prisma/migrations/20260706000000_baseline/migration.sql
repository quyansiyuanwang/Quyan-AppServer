-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `password` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `twoFactorEnabled` BOOLEAN NOT NULL DEFAULT false,
    `twoFactorPasskeyRequired` BOOLEAN NOT NULL DEFAULT false,
    `groupId` VARCHAR(191) NULL,
    `permissionAdds` JSON NOT NULL,
    `permissionRemoves` JSON NOT NULL,
    `accountOwnerId` VARCHAR(191) NULL,
    `parentUserId` VARCHAR(191) NULL,
    `userType` VARCHAR(20) NOT NULL DEFAULT 'root',
    `ramUsername` VARCHAR(191) NULL,
    `displayName` VARCHAR(191) NULL,
    `forcePasswordChange` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `users_username_key`(`username`),
    INDEX `users_username_idx`(`username`),
    INDEX `users_groupId_idx`(`groupId`),
    INDEX `users_accountOwnerId_idx`(`accountOwnerId`),
    INDEX `users_parentUserId_idx`(`parentUserId`),
    INDEX `users_accountOwnerId_userType_idx`(`accountOwnerId`, `userType`),
    UNIQUE INDEX `users_accountOwnerId_ramUsername_key`(`accountOwnerId`, `ramUsername`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `groups` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `permissions` JSON NOT NULL,
    `level` INTEGER NOT NULL DEFAULT 1,
    `description` VARCHAR(191) NULL,
    `accountOwnerId` VARCHAR(191) NULL,

    UNIQUE INDEX `groups_username_key`(`username`),
    INDEX `groups_accountOwnerId_idx`(`accountOwnerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ram_roles` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `accountOwnerId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `trustPolicy` JSON NULL,
    `maxSessionDuration` INTEGER NOT NULL DEFAULT 3600,

    INDEX `ram_roles_accountOwnerId_idx`(`accountOwnerId`),
    INDEX `ram_roles_status_idx`(`status`),
    UNIQUE INDEX `ram_roles_accountOwnerId_name_key`(`accountOwnerId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ram_user_role_bindings` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `accountOwnerId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,

    INDEX `ram_user_role_bindings_accountOwnerId_idx`(`accountOwnerId`),
    INDEX `ram_user_role_bindings_userId_idx`(`userId`),
    INDEX `ram_user_role_bindings_roleId_idx`(`roleId`),
    UNIQUE INDEX `ram_user_role_bindings_accountOwnerId_userId_roleId_key`(`accountOwnerId`, `userId`, `roleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ram_group_role_bindings` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `accountOwnerId` VARCHAR(191) NOT NULL,
    `groupId` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,

    INDEX `ram_group_role_bindings_accountOwnerId_idx`(`accountOwnerId`),
    INDEX `ram_group_role_bindings_groupId_idx`(`groupId`),
    INDEX `ram_group_role_bindings_roleId_idx`(`roleId`),
    UNIQUE INDEX `ram_group_role_bindings_accountOwnerId_groupId_roleId_key`(`accountOwnerId`, `groupId`, `roleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ram_role_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `accountOwnerId` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,
    `subjectUserId` VARCHAR(191) NOT NULL,
    `sessionName` VARCHAR(191) NOT NULL,
    `tokenJtiHash` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,

    UNIQUE INDEX `ram_role_sessions_tokenJtiHash_key`(`tokenJtiHash`),
    INDEX `ram_role_sessions_accountOwnerId_idx`(`accountOwnerId`),
    INDEX `ram_role_sessions_roleId_idx`(`roleId`),
    INDEX `ram_role_sessions_subjectUserId_idx`(`subjectUserId`),
    INDEX `ram_role_sessions_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ram_policies` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `accountOwnerId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `activeName` VARCHAR(128) NULL,
    `description` TEXT NULL,
    `permissions` JSON NOT NULL,
    `type` VARCHAR(20) NOT NULL DEFAULT 'custom',

    INDEX `ram_policies_accountOwnerId_idx`(`accountOwnerId`),
    UNIQUE INDEX `ram_policies_accountOwnerId_activeName_key`(`accountOwnerId`, `activeName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ram_policy_attachments` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `accountOwnerId` VARCHAR(191) NOT NULL,
    `policyId` VARCHAR(191) NOT NULL,
    `targetType` VARCHAR(20) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,

    INDEX `ram_policy_attachments_accountOwnerId_idx`(`accountOwnerId`),
    INDEX `ram_policy_attachments_policyId_idx`(`policyId`),
    INDEX `ram_policy_attachments_targetType_targetId_idx`(`targetType`, `targetId`),
    UNIQUE INDEX `ram_policy_attachments_accountOwnerId_policyId_targetType_ta_key`(`accountOwnerId`, `policyId`, `targetType`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `api_logs` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `requestID` VARCHAR(191) NOT NULL,
    `userID` VARCHAR(191) NULL,
    `path` VARCHAR(191) NOT NULL,
    `method` VARCHAR(191) NOT NULL,
    `requestHeaders` JSON NULL,
    `queryParams` JSON NULL,
    `bodyParams` JSON NULL,
    `ipAddress` VARCHAR(191) NOT NULL,
    `response` JSON NULL,
    `responseHeaders` JSON NULL,
    `statusCode` INTEGER NOT NULL,

    UNIQUE INDEX `api_logs_requestID_key`(`requestID`),
    INDEX `api_logs_userID_idx`(`userID`),
    INDEX `api_logs_path_idx`(`path`),
    INDEX `api_logs_createTime_idx`(`createTime`),
    INDEX `api_logs_status_createTime_idx`(`status`, `createTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `business_logs` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `operationType` VARCHAR(191) NOT NULL,
    `operationCategory` VARCHAR(191) NOT NULL,
    `actorUserId` VARCHAR(191) NULL,
    `targetUserId` VARCHAR(191) NULL,
    `targetResourceId` VARCHAR(191) NULL,
    `targetResourceType` VARCHAR(191) NULL,
    `description` TEXT NOT NULL,
    `changes` JSON NULL,
    `metadata` JSON NULL,
    `success` BOOLEAN NOT NULL DEFAULT true,
    `errorMessage` TEXT NULL,
    `requestId` VARCHAR(191) NULL,
    `ipAddress` VARCHAR(191) NOT NULL,
    `userAgent` TEXT NULL,

    INDEX `business_logs_actorUserId_idx`(`actorUserId`),
    INDEX `business_logs_targetUserId_idx`(`targetUserId`),
    INDEX `business_logs_operationType_idx`(`operationType`),
    INDEX `business_logs_operationCategory_idx`(`operationCategory`),
    INDEX `business_logs_createTime_idx`(`createTime`),
    INDEX `business_logs_requestId_idx`(`requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_online_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `authSessionId` VARCHAR(191) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastHeartbeatAt` DATETIME(3) NOT NULL,
    `endedAt` DATETIME(3) NULL,
    `durationSeconds` INTEGER NULL,
    `lastIpAddress` VARCHAR(191) NOT NULL,
    `lastLocation` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,

    INDEX `user_online_sessions_userId_idx`(`userId`),
    INDEX `user_online_sessions_authSessionId_idx`(`authSessionId`),
    INDEX `user_online_sessions_startedAt_idx`(`startedAt`),
    INDEX `user_online_sessions_lastHeartbeatAt_idx`(`lastHeartbeatAt`),
    INDEX `user_online_sessions_status_idx`(`status`),
    INDEX `user_online_sessions_userId_authSessionId_status_idx`(`userId`, `authSessionId`, `status`),
    INDEX `user_online_sessions_userId_startedAt_idx`(`userId`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `server_configs` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` TEXT NOT NULL,

    UNIQUE INDEX `server_configs_key_key`(`key`),
    INDEX `server_configs_key_idx`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_verifications` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `used` BOOLEAN NOT NULL DEFAULT false,

    INDEX `email_verifications_email_code_idx`(`email`, `code`),
    INDEX `email_verifications_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_rate_limit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `ipAddress` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL DEFAULT 'verification_code',
    `requestTime` DATETIME(3) NOT NULL,

    INDEX `email_rate_limit_logs_ipAddress_action_requestTime_idx`(`ipAddress`, `action`, `requestTime`),
    INDEX `email_rate_limit_logs_email_action_requestTime_idx`(`email`, `action`, `requestTime`),
    INDEX `email_rate_limit_logs_ipAddress_email_action_requestTime_idx`(`ipAddress`, `email`, `action`, `requestTime`),
    INDEX `email_rate_limit_logs_requestTime_idx`(`requestTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ip_black_lists` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `ipAddress` VARCHAR(191) NOT NULL,
    `ExpireTime` DATETIME(3) NULL,
    `triedAccounts` INTEGER NOT NULL DEFAULT 0,
    `reason` TEXT NULL,
    `bannedBy` VARCHAR(191) NULL,
    `banType` VARCHAR(191) NOT NULL DEFAULT 'auto',
    `banLevel` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `ip_black_lists_ipAddress_key`(`ipAddress`),
    INDEX `ip_black_lists_ipAddress_idx`(`ipAddress`),
    INDEX `ip_black_lists_status_ExpireTime_idx`(`status`, `ExpireTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ip_white_lists` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `ipAddress` VARCHAR(191) NOT NULL,
    `reason` TEXT NULL,
    `addedBy` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NULL,

    UNIQUE INDEX `ip_white_lists_ipAddress_key`(`ipAddress`),
    INDEX `ip_white_lists_ipAddress_idx`(`ipAddress`),
    INDEX `ip_white_lists_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `passkey_credentials` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `credentialId` VARCHAR(191) NOT NULL,
    `publicKey` LONGBLOB NOT NULL,
    `counter` BIGINT NOT NULL DEFAULT 0,
    `deviceType` VARCHAR(191) NULL,
    `backedUp` BOOLEAN NOT NULL DEFAULT false,
    `transports` VARCHAR(191) NULL,
    `name` VARCHAR(191) NULL,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,

    UNIQUE INDEX `passkey_credentials_credentialId_key`(`credentialId`),
    INDEX `passkey_credentials_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `two_factor_credentials` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `secret` TEXT NOT NULL,
    `recoveryCodeHashes` JSON NOT NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,

    UNIQUE INDEX `two_factor_credentials_userId_key`(`userId`),
    INDEX `two_factor_credentials_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `relay_channels` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `openaiUpstreamUrl` TEXT NULL,
    `openaiUpstreamApiKey` TEXT NULL,
    `anthropicUpstreamUrl` TEXT NULL,
    `anthropicUpstreamApiKey` TEXT NULL,
    `geminiUpstreamUrl` TEXT NULL,
    `geminiUpstreamApiKey` TEXT NULL,
    `multiplier` DECIMAL(10, 6) NOT NULL DEFAULT 1.0,
    `allowedFormats` VARCHAR(50) NOT NULL DEFAULT 'all',
    `allowedModels` TEXT NULL,
    `addUserIdentifier` BOOLEAN NOT NULL DEFAULT true,
    `inputTokensIncludeCacheRead` BOOLEAN NOT NULL DEFAULT false,
    `modelMapping` JSON NULL,
    `timePeriodMultipliers` JSON NULL,

    INDEX `relay_channels_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `relay_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `token` VARCHAR(191) NOT NULL,
    `upstreamUrl` TEXT NULL,
    `upstreamApiKey` TEXT NULL,
    `channelId` VARCHAR(191) NULL,
    `totalTokens` INTEGER NOT NULL DEFAULT 0,
    `requestCount` INTEGER NOT NULL DEFAULT 0,
    `usedQuota` DECIMAL(10, 4) NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `quotaLimit` DECIMAL(10, 2) NULL,
    `allowedModels` TEXT NULL,
    `ipWhitelist` TEXT NULL,
    `modelMapping` JSON NULL,
    `isCustomKey` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `relay_tokens_token_key`(`token`),
    INDEX `relay_tokens_userId_idx`(`userId`),
    INDEX `relay_tokens_token_idx`(`token`),
    INDEX `relay_tokens_channelId_idx`(`channelId`),
    INDEX `relay_tokens_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `relay_token_quota_windows` (
    `id` VARCHAR(191) NOT NULL,
    `relayTokenId` VARCHAR(191) NOT NULL,
    `quotaLimit` DECIMAL(10, 4) NOT NULL,
    `quotaUnit` VARCHAR(20) NOT NULL,
    `quotaWindowHours` DECIMAL(10, 4) NOT NULL,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,

    INDEX `relay_token_quota_windows_relayTokenId_quotaWindowHours_idx`(`relayTokenId`, `quotaWindowHours`),
    UNIQUE INDEX `relay_token_quota_windows_relayTokenId_quotaUnit_quotaWindow_key`(`relayTokenId`, `quotaUnit`, `quotaWindowHours`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `relay_token_failover_configs` (
    `id` VARCHAR(191) NOT NULL,
    `relayTokenId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `maxRetries` INTEGER NOT NULL DEFAULT 0,
    `retryStatusCodes` JSON NULL,
    `failoverThreshold` INTEGER NOT NULL DEFAULT 0,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,

    UNIQUE INDEX `relay_token_failover_configs_relayTokenId_key`(`relayTokenId`),
    INDEX `relay_token_failover_configs_relayTokenId_idx`(`relayTokenId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `relay_token_channel_configs` (
    `id` VARCHAR(191) NOT NULL,
    `relayTokenId` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `priority` INTEGER NOT NULL,
    `successCount` INTEGER NOT NULL DEFAULT 0,
    `failureCount` INTEGER NOT NULL DEFAULT 0,
    `lastUsedAt` DATETIME(3) NULL,
    `lastSuccessAt` DATETIME(3) NULL,
    `lastFailureAt` DATETIME(3) NULL,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,

    INDEX `relay_token_channel_configs_relayTokenId_priority_idx`(`relayTokenId`, `priority`),
    INDEX `relay_token_channel_configs_channelId_idx`(`channelId`),
    UNIQUE INDEX `relay_token_channel_configs_relayTokenId_channelId_key`(`relayTokenId`, `channelId`),
    UNIQUE INDEX `relay_token_channel_configs_relayTokenId_priority_key`(`relayTokenId`, `priority`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `relay_channel_switch_logs` (
    `id` VARCHAR(191) NOT NULL,
    `relayTokenId` VARCHAR(191) NOT NULL,
    `fromChannelId` VARCHAR(191) NOT NULL,
    `toChannelId` VARCHAR(191) NOT NULL,
    `triggerStatusCode` INTEGER NULL,
    `triggerError` TEXT NULL,
    `attemptNumber` INTEGER NOT NULL,
    `requestPath` VARCHAR(191) NOT NULL,
    `method` VARCHAR(191) NOT NULL,
    `modelName` VARCHAR(191) NULL,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,

    INDEX `relay_channel_switch_logs_relayTokenId_createTime_idx`(`relayTokenId`, `createTime`),
    INDEX `relay_channel_switch_logs_fromChannelId_idx`(`fromChannelId`),
    INDEX `relay_channel_switch_logs_toChannelId_idx`(`toChannelId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `relay_usages` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `relayTokenId` VARCHAR(191) NOT NULL,
    `requestTokens` INTEGER NOT NULL DEFAULT 0,
    `responseTokens` INTEGER NOT NULL DEFAULT 0,
    `totalTokens` INTEGER NOT NULL DEFAULT 0,
    `cacheCreationTokens` INTEGER NOT NULL DEFAULT 0,
    `cacheReadTokens` INTEGER NOT NULL DEFAULT 0,
    `path` VARCHAR(191) NOT NULL,
    `method` VARCHAR(191) NOT NULL,
    `statusCode` INTEGER NOT NULL,
    `ipAddress` VARCHAR(191) NOT NULL,
    `totalOutputTime` INTEGER NULL,
    `timeToFirstByte` INTEGER NULL,
    `isStreaming` BOOLEAN NOT NULL DEFAULT false,

    INDEX `relay_usages_relayTokenId_idx`(`relayTokenId`),
    INDEX `relay_usages_createTime_idx`(`createTime`),
    INDEX `relay_usages_relayTokenId_createTime_idx`(`relayTokenId`, `createTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `access_keys` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `key` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `requestCount` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `access_keys_key_key`(`key`),
    INDEX `access_keys_userId_idx`(`userId`),
    INDEX `access_keys_key_idx`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oauth_clients` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `reviewedByUserId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `clientSecretHash` TEXT NULL,
    `clientSecretPreview` VARCHAR(191) NULL,
    `clientType` VARCHAR(20) NOT NULL DEFAULT 'confidential',
    `reviewStatus` VARCHAR(20) NOT NULL DEFAULT 'draft',
    `reviewComment` TEXT NULL,
    `submittedAt` DATETIME(3) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `grantTypes` JSON NOT NULL,
    `redirectUris` JSON NOT NULL,
    `scopes` JSON NOT NULL,
    `homepageUrl` TEXT NULL,
    `logoUrl` TEXT NULL,
    `policyUrl` TEXT NULL,
    `tosUrl` TEXT NULL,
    `isPkceRequired` BOOLEAN NOT NULL DEFAULT true,
    `accessTokenLifetime` INTEGER NOT NULL DEFAULT 3600,
    `refreshTokenLifetime` INTEGER NOT NULL DEFAULT 2592000,
    `lastUsedAt` DATETIME(3) NULL,

    UNIQUE INDEX `oauth_clients_clientId_key`(`clientId`),
    INDEX `oauth_clients_userId_idx`(`userId`),
    INDEX `oauth_clients_reviewedByUserId_idx`(`reviewedByUserId`),
    INDEX `oauth_clients_reviewStatus_idx`(`reviewStatus`),
    INDEX `oauth_clients_reviewStatus_submittedAt_idx`(`reviewStatus`, `submittedAt`),
    INDEX `oauth_clients_status_idx`(`status`),
    INDEX `oauth_clients_userId_status_createTime_idx`(`userId`, `status`, `createTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oauth_authorization_codes` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `oauthClientId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `redirectUri` TEXT NOT NULL,
    `scopes` JSON NOT NULL,
    `codeChallenge` VARCHAR(191) NULL,
    `codeChallengeMethod` VARCHAR(20) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `nonce` VARCHAR(191) NULL,
    `state` VARCHAR(191) NULL,

    UNIQUE INDEX `oauth_authorization_codes_codeHash_key`(`codeHash`),
    INDEX `oauth_authorization_codes_oauthClientId_expiresAt_idx`(`oauthClientId`, `expiresAt`),
    INDEX `oauth_authorization_codes_userId_expiresAt_idx`(`userId`, `expiresAt`),
    INDEX `oauth_authorization_codes_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oauth_access_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `oauthClientId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `tokenJti` VARCHAR(191) NULL,
    `scopes` JSON NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `oauth_access_tokens_tokenHash_key`(`tokenHash`),
    UNIQUE INDEX `oauth_access_tokens_tokenJti_key`(`tokenJti`),
    INDEX `oauth_access_tokens_oauthClientId_expiresAt_idx`(`oauthClientId`, `expiresAt`),
    INDEX `oauth_access_tokens_userId_expiresAt_idx`(`userId`, `expiresAt`),
    INDEX `oauth_access_tokens_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oauth_refresh_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `oauthClientId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `oauth_refresh_tokens_tokenHash_key`(`tokenHash`),
    INDEX `oauth_refresh_tokens_oauthClientId_expiresAt_idx`(`oauthClientId`, `expiresAt`),
    INDEX `oauth_refresh_tokens_userId_expiresAt_idx`(`userId`, `expiresAt`),
    INDEX `oauth_refresh_tokens_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oauth_consents` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `oauthClientId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `scopes` JSON NOT NULL,
    `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,

    INDEX `oauth_consents_userId_grantedAt_idx`(`userId`, `grantedAt`),
    INDEX `oauth_consents_status_grantedAt_idx`(`status`, `grantedAt`),
    UNIQUE INDEX `oauth_consents_oauthClientId_userId_key`(`oauthClientId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_center_clients` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `reviewedByUserId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `clientSecretHash` TEXT NULL,
    `clientSecretPreview` VARCHAR(191) NULL,
    `clientType` VARCHAR(20) NOT NULL DEFAULT 'confidential',
    `reviewStatus` VARCHAR(20) NOT NULL DEFAULT 'draft',
    `reviewComment` TEXT NULL,
    `submittedAt` DATETIME(3) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `grantTypes` JSON NOT NULL,
    `redirectUris` JSON NOT NULL,
    `scopes` JSON NOT NULL,
    `homepageUrl` TEXT NULL,
    `logoUrl` TEXT NULL,
    `policyUrl` TEXT NULL,
    `tosUrl` TEXT NULL,
    `isPkceRequired` BOOLEAN NOT NULL DEFAULT true,
    `accessTokenLifetime` INTEGER NOT NULL DEFAULT 3600,
    `refreshTokenLifetime` INTEGER NOT NULL DEFAULT 2592000,
    `lastUsedAt` DATETIME(3) NULL,

    UNIQUE INDEX `auth_center_clients_clientId_key`(`clientId`),
    INDEX `auth_center_clients_userId_idx`(`userId`),
    INDEX `auth_center_clients_reviewedByUserId_idx`(`reviewedByUserId`),
    INDEX `auth_center_clients_reviewStatus_idx`(`reviewStatus`),
    INDEX `auth_center_clients_reviewStatus_submittedAt_idx`(`reviewStatus`, `submittedAt`),
    INDEX `auth_center_clients_status_idx`(`status`),
    INDEX `auth_center_clients_userId_status_createTime_idx`(`userId`, `status`, `createTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_center_authorization_codes` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `authCenterClientId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `redirectUri` TEXT NOT NULL,
    `scopes` JSON NOT NULL,
    `codeChallenge` VARCHAR(191) NULL,
    `codeChallengeMethod` VARCHAR(20) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `nonce` VARCHAR(191) NULL,
    `state` VARCHAR(191) NULL,

    UNIQUE INDEX `auth_center_authorization_codes_codeHash_key`(`codeHash`),
    INDEX `auth_center_authorization_codes_authCenterClientId_expiresAt_idx`(`authCenterClientId`, `expiresAt`),
    INDEX `auth_center_authorization_codes_userId_expiresAt_idx`(`userId`, `expiresAt`),
    INDEX `auth_center_authorization_codes_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_center_access_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `authCenterClientId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `tokenJti` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `scopes` JSON NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `auth_center_access_tokens_tokenHash_key`(`tokenHash`),
    UNIQUE INDEX `auth_center_access_tokens_tokenJti_key`(`tokenJti`),
    INDEX `auth_center_access_tokens_authCenterClientId_expiresAt_idx`(`authCenterClientId`, `expiresAt`),
    INDEX `auth_center_access_tokens_userId_expiresAt_idx`(`userId`, `expiresAt`),
    INDEX `auth_center_access_tokens_status_expiresAt_idx`(`status`, `expiresAt`),
    INDEX `auth_center_access_tokens_tokenJti_idx`(`tokenJti`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_center_refresh_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `authCenterClientId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `auth_center_refresh_tokens_tokenHash_key`(`tokenHash`),
    INDEX `auth_center_refresh_tokens_authCenterClientId_expiresAt_idx`(`authCenterClientId`, `expiresAt`),
    INDEX `auth_center_refresh_tokens_userId_expiresAt_idx`(`userId`, `expiresAt`),
    INDEX `auth_center_refresh_tokens_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_center_consents` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `authCenterClientId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `scopes` JSON NOT NULL,
    `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,

    INDEX `auth_center_consents_userId_grantedAt_idx`(`userId`, `grantedAt`),
    INDEX `auth_center_consents_status_grantedAt_idx`(`status`, `grantedAt`),
    UNIQUE INDEX `auth_center_consents_authCenterClientId_userId_key`(`authCenterClientId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `redemption_codes` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(15, 4) NOT NULL,
    `usedBy` VARCHAR(191) NULL,
    `usedAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NULL,

    UNIQUE INDEX `redemption_codes_code_key`(`code`),
    INDEX `redemption_codes_code_idx`(`code`),
    INDEX `redemption_codes_usedBy_idx`(`usedBy`),
    INDEX `redemption_codes_createdBy_idx`(`createdBy`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `balance_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `balance` DECIMAL(10, 4) NOT NULL DEFAULT 0,
    `totalRecharged` DECIMAL(10, 4) NOT NULL DEFAULT 0,
    `totalUsed` DECIMAL(10, 4) NOT NULL DEFAULT 0,

    UNIQUE INDEX `balance_accounts_userId_key`(`userId`),
    INDEX `balance_accounts_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `balance_transactions` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 4) NOT NULL,
    `balanceBefore` DECIMAL(10, 4) NOT NULL,
    `balanceAfter` DECIMAL(10, 4) NOT NULL,
    `relatedId` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `model` VARCHAR(191) NULL,
    `tokens` INTEGER NULL,
    `inputTokens` INTEGER NULL,
    `outputTokens` INTEGER NULL,
    `cacheCreationTokens` INTEGER NULL,
    `cacheReadTokens` INTEGER NULL,
    `inputRate` DECIMAL(10, 6) NULL,
    `outputRate` DECIMAL(10, 6) NULL,
    `multiplier` DECIMAL(10, 2) NULL,
    `cacheCreationMultiplier` DECIMAL(10, 2) NULL,
    `cacheReadMultiplier` DECIMAL(10, 2) NULL,
    `channelName` TEXT NULL,
    `channelMultiplier` DECIMAL(10, 6) NULL,
    `globalMultiplier` DECIMAL(10, 6) NULL,
    `timeMultiplier` DECIMAL(10, 6) NULL,
    `pricingType` VARCHAR(20) NULL,
    `fixedPrice` DECIMAL(10, 4) NULL,

    INDEX `balance_transactions_userId_idx`(`userId`),
    INDEX `balance_transactions_type_idx`(`type`),
    INDEX `balance_transactions_createTime_idx`(`createTime`),
    INDEX `balance_transactions_userId_createTime_idx`(`userId`, `createTime`),
    INDEX `balance_transactions_userId_type_createTime_idx`(`userId`, `type`, `createTime`),
    INDEX `balance_transactions_model_idx`(`model`),
    INDEX `balance_transactions_userId_model_createTime_idx`(`userId`, `model`, `createTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `monthly_pass_templates` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `publishStatus` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `publishedAt` DATETIME(3) NULL,
    `originalPrice` DECIMAL(10, 4) NULL,
    `discountPercent` DECIMAL(5, 2) NULL,
    `discountedPrice` DECIMAL(10, 4) NULL,
    `rechargeRatio` DECIMAL(10, 4) NULL,
    `defaultQuota` DECIMAL(10, 4) NOT NULL,
    `dailyQuota` DECIMAL(10, 4) NULL,
    `quotaUnit` VARCHAR(20) NOT NULL DEFAULT 'amount',
    `quotaWindowHours` INTEGER NULL,
    `purchaseLimitPerUser` INTEGER NULL,
    `purchaseLimitWindowDays` INTEGER NULL,
    `allowBalanceRedemption` BOOLEAN NOT NULL DEFAULT true,
    `allowedModels` TEXT NULL,
    `allowedChannels` TEXT NULL,

    UNIQUE INDEX `monthly_pass_templates_name_key`(`name`),
    INDEX `monthly_pass_templates_status_idx`(`status`),
    INDEX `monthly_pass_templates_publishStatus_idx`(`publishStatus`),
    INDEX `monthly_pass_templates_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `remote_terminal_product_templates` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `publishStatus` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `publishedAt` DATETIME(3) NULL,
    `billingUnit` VARCHAR(16) NOT NULL DEFAULT 'day',
    `minimumPurchaseUnits` INTEGER NOT NULL DEFAULT 1,
    `maximumPurchaseUnits` INTEGER NULL,
    `devicePrice` DECIMAL(10, 4) NULL,
    `terminalPrice` DECIMAL(10, 4) NULL,
    `deviceDailyPrice` DECIMAL(10, 4) NULL,
    `terminalDailyPrice` DECIMAL(10, 4) NULL,
    `currency` VARCHAR(16) NOT NULL DEFAULT '曲',
    `purchaseLimitPerUser` INTEGER NULL,
    `purchaseLimitWindowDays` INTEGER NULL,
    `minimumDeviceCount` INTEGER NULL,
    `minimumTerminalCount` INTEGER NULL,
    `maxDeviceCount` INTEGER NULL,
    `maxTerminalCount` INTEGER NULL,

    UNIQUE INDEX `remote_terminal_product_templates_name_key`(`name`),
    INDEX `remote_terminal_product_templates_status_idx`(`status`),
    INDEX `remote_terminal_product_templates_publishStatus_idx`(`publishStatus`),
    INDEX `remote_terminal_product_templates_name_idx`(`name`),
    INDEX `remote_terminal_product_templates_purchaseLimitWindowDays_idx`(`purchaseLimitWindowDays`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `remote_terminal_user_entitlements` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `startAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NOT NULL,
    `billingUnit` VARCHAR(16) NOT NULL DEFAULT 'day',
    `purchaseUnits` INTEGER NOT NULL DEFAULT 1,
    `deviceLimit` INTEGER NOT NULL,
    `terminalLimit` INTEGER NOT NULL,
    `durationDays` INTEGER NOT NULL DEFAULT 0,
    `purchasedDeviceCount` INTEGER NOT NULL DEFAULT 0,
    `purchasedTerminalCount` INTEGER NOT NULL DEFAULT 0,
    `devicePrice` DECIMAL(10, 4) NULL,
    `terminalPrice` DECIMAL(10, 4) NULL,
    `deviceDailyPrice` DECIMAL(10, 4) NULL,
    `terminalDailyPrice` DECIMAL(10, 4) NULL,
    `purchaseAmount` DECIMAL(10, 4) NULL,
    `currency` VARCHAR(16) NOT NULL DEFAULT '曲',
    `assignedBy` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `maxDeviceCount` INTEGER NULL,
    `maxTerminalCount` INTEGER NULL,
    `unbindResetAt` DATETIME(3) NULL,

    INDEX `remote_terminal_user_entitlements_userId_idx`(`userId`),
    INDEX `remote_terminal_user_entitlements_templateId_idx`(`templateId`),
    INDEX `remote_terminal_user_entitlements_status_startAt_endAt_idx`(`status`, `startAt`, `endAt`),
    INDEX `remote_terminal_user_entitlements_userId_status_endAt_idx`(`userId`, `status`, `endAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `remote_terminal_entitlement_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `entitlementId` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,

    UNIQUE INDEX `remote_terminal_entitlement_tokens_entitlementId_key`(`entitlementId`),
    UNIQUE INDEX `remote_terminal_entitlement_tokens_token_key`(`token`),
    INDEX `remote_terminal_entitlement_tokens_token_idx`(`token`),
    INDEX `remote_terminal_entitlement_tokens_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `remote_terminal_device_bindings` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `entitlementId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `registrationTokenId` VARCHAR(191) NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `fingerprint` VARCHAR(191) NOT NULL,
    `fingerprintVersion` VARCHAR(32) NOT NULL DEFAULT 'v1',
    `hostname` VARCHAR(191) NOT NULL,
    `platform` VARCHAR(32) NOT NULL,
    `arch` VARCHAR(64) NOT NULL,
    `snapshot` JSON NOT NULL,
    `heartbeatToken` VARCHAR(191) NOT NULL,
    `registeredAt` DATETIME(3) NOT NULL,
    `lastSeenAt` DATETIME(3) NOT NULL,
    `lastOnlineAt` DATETIME(3) NULL,
    `online` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `remote_terminal_device_bindings_deviceId_key`(`deviceId`),
    INDEX `remote_terminal_device_bindings_userId_idx`(`userId`),
    INDEX `remote_terminal_device_bindings_entitlementId_idx`(`entitlementId`),
    INDEX `remote_terminal_device_bindings_registrationTokenId_idx`(`registrationTokenId`),
    INDEX `remote_terminal_device_bindings_status_lastSeenAt_idx`(`status`, `lastSeenAt`),
    INDEX `remote_terminal_device_bindings_userId_status_lastSeenAt_idx`(`userId`, `status`, `lastSeenAt`),
    UNIQUE INDEX `remote_terminal_device_bindings_entitlementId_fingerprint_key`(`entitlementId`, `fingerprint`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `monthly_pass_template_quota_windows` (
    `id` VARCHAR(191) NOT NULL,
    `monthlyPassTemplateId` VARCHAR(191) NOT NULL,
    `quotaLimit` DECIMAL(10, 4) NOT NULL,
    `quotaUnit` VARCHAR(20) NOT NULL,
    `quotaWindowHours` DECIMAL(10, 4) NOT NULL,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,

    INDEX `monthly_pass_template_quota_windows_monthlyPassTemplateId_qu_idx`(`monthlyPassTemplateId`, `quotaWindowHours`),
    UNIQUE INDEX `monthly_pass_template_quota_windows_monthlyPassTemplateId_qu_key`(`monthlyPassTemplateId`, `quotaUnit`, `quotaWindowHours`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_monthly_passes` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `startAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NOT NULL,
    `totalQuota` DECIMAL(10, 4) NOT NULL,
    `dailyQuota` DECIMAL(10, 4) NULL,
    `quotaUnit` VARCHAR(20) NOT NULL DEFAULT 'amount',
    `quotaWindowHours` INTEGER NULL,
    `usedQuota` DECIMAL(10, 4) NOT NULL DEFAULT 0,
    `remainingQuota` DECIMAL(10, 4) NOT NULL,
    `assignedBy` VARCHAR(191) NULL,
    `note` TEXT NULL,

    INDEX `user_monthly_passes_userId_idx`(`userId`),
    INDEX `user_monthly_passes_templateId_idx`(`templateId`),
    INDEX `user_monthly_passes_status_startAt_endAt_idx`(`status`, `startAt`, `endAt`),
    INDEX `user_monthly_passes_userId_status_endAt_idx`(`userId`, `status`, `endAt`),
    INDEX `user_monthly_passes_userId_status_remainingQuota_startAt_end_idx`(`userId`, `status`, `remainingQuota`, `startAt`, `endAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_monthly_pass_quota_windows` (
    `id` VARCHAR(191) NOT NULL,
    `userMonthlyPassId` VARCHAR(191) NOT NULL,
    `quotaLimit` DECIMAL(10, 4) NOT NULL,
    `quotaUnit` VARCHAR(20) NOT NULL,
    `quotaWindowHours` DECIMAL(10, 4) NOT NULL,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,

    INDEX `user_monthly_pass_quota_windows_userMonthlyPassId_quotaWindo_idx`(`userMonthlyPassId`, `quotaWindowHours`),
    UNIQUE INDEX `user_monthly_pass_quota_windows_userMonthlyPassId_quotaUnit__key`(`userMonthlyPassId`, `quotaUnit`, `quotaWindowHours`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `monthly_pass_usages` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userMonthlyPassId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `relayUsageId` VARCHAR(191) NULL,
    `model` VARCHAR(191) NULL,
    `channelId` VARCHAR(191) NULL,
    `channelName` TEXT NULL,
    `coveredAmount` DECIMAL(10, 4) NOT NULL,
    `coveredRequests` INTEGER NOT NULL DEFAULT 0,
    `coveredTokens` INTEGER NOT NULL DEFAULT 0,
    `totalRequestCost` DECIMAL(10, 4) NOT NULL,
    `remainingRequestCost` DECIMAL(10, 4) NOT NULL,
    `description` TEXT NULL,

    INDEX `monthly_pass_usages_userMonthlyPassId_idx`(`userMonthlyPassId`),
    INDEX `monthly_pass_usages_userId_createTime_idx`(`userId`, `createTime`),
    INDEX `monthly_pass_usages_relayUsageId_idx`(`relayUsageId`),
    INDEX `monthly_pass_usages_model_idx`(`model`),
    INDEX `monthly_pass_usages_userMonthlyPassId_status_createTime_idx`(`userMonthlyPassId`, `status`, `createTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `model_pricing` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `pricingType` VARCHAR(20) NOT NULL DEFAULT 'token-based',
    `inputPrice` DECIMAL(10, 2) NOT NULL,
    `outputPrice` DECIMAL(10, 2) NOT NULL,
    `fixedPrice` DECIMAL(10, 4) NULL,
    `provider` VARCHAR(191) NULL,
    `cacheCreationMultiplier` DECIMAL(10, 2) NOT NULL DEFAULT 1.25,
    `cacheReadMultiplier` DECIMAL(10, 2) NOT NULL DEFAULT 0.10,
    `supportedFormats` VARCHAR(20) NOT NULL DEFAULT 'all',

    UNIQUE INDEX `model_pricing_model_key`(`model`),
    INDEX `model_pricing_model_idx`(`model`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `relay_configs` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `globalMultiplier` DECIMAL(10, 6) NOT NULL DEFAULT 1.0,
    `maxConcurrency` INTEGER NOT NULL DEFAULT 5,
    `queueTimeout` INTEGER NOT NULL DEFAULT 30000,
    `upstreamStreamTimeout` INTEGER NOT NULL DEFAULT 120000,
    `enableQueue` BOOLEAN NOT NULL DEFAULT true,
    `uptimeStatusUrl` TEXT NULL,
    `monitorNameMapping` JSON NULL,
    `showOnlyConfigured` BOOLEAN NULL,
    `uptimeTransformRules` JSON NULL,
    `uptimeStaticData` JSON NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oj_api_keys` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `key` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `requestCount` INTEGER NOT NULL DEFAULT 0,
    `totalTokens` INTEGER NOT NULL DEFAULT 0,
    `channelId` VARCHAR(191) NULL,

    UNIQUE INDEX `oj_api_keys_key_key`(`key`),
    INDEX `oj_api_keys_userId_idx`(`userId`),
    INDEX `oj_api_keys_key_idx`(`key`),
    INDEX `oj_api_keys_status_expiresAt_idx`(`status`, `expiresAt`),
    INDEX `oj_api_keys_channelId_idx`(`channelId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oj_model_pricing` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `inputPrice` DECIMAL(10, 2) NOT NULL,
    `outputPrice` DECIMAL(10, 2) NOT NULL,
    `multiplier` DECIMAL(10, 2) NOT NULL DEFAULT 1.0,
    `cacheCreationMultiplier` DECIMAL(10, 2) NOT NULL DEFAULT 1.25,
    `cacheReadMultiplier` DECIMAL(10, 2) NOT NULL DEFAULT 0.10,
    `provider` VARCHAR(191) NULL,

    UNIQUE INDEX `oj_model_pricing_model_key`(`model`),
    INDEX `oj_model_pricing_model_idx`(`model`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oj_usage_records` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `ojApiKeyId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `question` TEXT NOT NULL,
    `answer` LONGTEXT NOT NULL,
    `inputTokens` INTEGER NOT NULL DEFAULT 0,
    `outputTokens` INTEGER NOT NULL DEFAULT 0,
    `totalTokens` INTEGER NOT NULL DEFAULT 0,
    `cacheCreationTokens` INTEGER NOT NULL DEFAULT 0,
    `cacheReadTokens` INTEGER NOT NULL DEFAULT 0,
    `cost` DECIMAL(10, 4) NOT NULL,
    `ipAddress` VARCHAR(191) NOT NULL,
    `responseTime` INTEGER NULL,

    INDEX `oj_usage_records_ojApiKeyId_idx`(`ojApiKeyId`),
    INDEX `oj_usage_records_userId_idx`(`userId`),
    INDEX `oj_usage_records_createTime_idx`(`createTime`),
    INDEX `oj_usage_records_userId_createTime_idx`(`userId`, `createTime`),
    INDEX `oj_usage_records_model_idx`(`model`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `json_endpoints` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `jsonContent` JSON NOT NULL,
    `apiKey` VARCHAR(191) NULL,
    `isPublic` BOOLEAN NOT NULL DEFAULT true,
    `accessCount` INTEGER NOT NULL DEFAULT 0,
    `lastAccessAt` DATETIME(3) NULL,

    UNIQUE INDEX `json_endpoints_slug_key`(`slug`),
    UNIQUE INDEX `json_endpoints_apiKey_key`(`apiKey`),
    INDEX `json_endpoints_userId_idx`(`userId`),
    INDEX `json_endpoints_slug_idx`(`slug`),
    INDEX `json_endpoints_apiKey_idx`(`apiKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `articles` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NULL,
    `summary` TEXT NULL,
    `content` TEXT NOT NULL,
    `publishStatus` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `publishedAt` DATETIME(3) NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `isPublic` BOOLEAN NOT NULL DEFAULT false,
    `requirePermission` VARCHAR(191) NULL,
    `viewCount` INTEGER NOT NULL DEFAULT 0,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `articles_slug_key`(`slug`),
    INDEX `articles_authorId_idx`(`authorId`),
    INDEX `articles_slug_idx`(`slug`),
    INDEX `articles_category_idx`(`category`),
    INDEX `articles_publishStatus_idx`(`publishStatus`),
    INDEX `articles_isPublic_idx`(`isPublic`),
    INDEX `articles_sortOrder_idx`(`sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `legal_policy_versions` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `policyType` VARCHAR(30) NOT NULL,
    `version` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `summary` TEXT NULL,
    `content` LONGTEXT NOT NULL,
    `contentFormat` VARCHAR(20) NOT NULL DEFAULT 'markdown',
    `publishStatus` VARCHAR(20) NOT NULL DEFAULT 'draft',
    `isCurrent` BOOLEAN NOT NULL DEFAULT false,
    `publishedAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `updatedBy` VARCHAR(191) NULL,

    INDEX `legal_policy_versions_policyType_publishStatus_idx`(`policyType`, `publishStatus`),
    INDEX `legal_policy_versions_policyType_isCurrent_idx`(`policyType`, `isCurrent`),
    INDEX `legal_policy_versions_createdBy_idx`(`createdBy`),
    INDEX `legal_policy_versions_updatedBy_idx`(`updatedBy`),
    UNIQUE INDEX `legal_policy_versions_policyType_version_key`(`policyType`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_policy_acceptances` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `policyVersionId` VARCHAR(191) NOT NULL,
    `policyType` VARCHAR(30) NOT NULL,
    `source` VARCHAR(30) NOT NULL DEFAULT 'auth',
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `acceptedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_policy_acceptances_userId_policyType_acceptedAt_idx`(`userId`, `policyType`, `acceptedAt`),
    INDEX `user_policy_acceptances_policyVersionId_idx`(`policyVersionId`),
    INDEX `user_policy_acceptances_policyType_acceptedAt_idx`(`policyType`, `acceptedAt`),
    UNIQUE INDEX `user_policy_acceptances_userId_policyVersionId_key`(`userId`, `policyVersionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tickets` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NOT NULL,
    `sourcePage` VARCHAR(500) NULL,
    `reproduceSteps` TEXT NULL,
    `contactInfo` VARCHAR(200) NULL,
    `workflowStatus` VARCHAR(30) NOT NULL DEFAULT 'pending',
    `priority` VARCHAR(20) NOT NULL DEFAULT 'medium',
    `assigneeUserId` VARCHAR(191) NULL,
    `lastReplyAt` DATETIME(3) NULL,

    INDEX `tickets_userId_idx`(`userId`),
    INDEX `tickets_userId_workflowStatus_idx`(`userId`, `workflowStatus`),
    INDEX `tickets_workflowStatus_createTime_idx`(`workflowStatus`, `createTime`),
    INDEX `tickets_assigneeUserId_idx`(`assigneeUserId`),
    INDEX `tickets_priority_idx`(`priority`),
    INDEX `tickets_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticket_comments` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `ticketId` VARCHAR(191) NOT NULL,
    `authorUserId` VARCHAR(191) NOT NULL,
    `visibility` VARCHAR(20) NOT NULL DEFAULT 'public',
    `content` TEXT NOT NULL,

    INDEX `ticket_comments_ticketId_createTime_idx`(`ticketId`, `createTime`),
    INDEX `ticket_comments_authorUserId_idx`(`authorUserId`),
    INDEX `ticket_comments_visibility_idx`(`visibility`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_scripts` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `content` TEXT NOT NULL,

    INDEX `user_scripts_userId_idx`(`userId`),
    INDEX `user_scripts_userId_status_idx`(`userId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_script_executions` (
    `id` VARCHAR(191) NOT NULL,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` VARCHAR(191) NOT NULL,
    `scriptId` VARCHAR(191) NULL,
    `scriptName` VARCHAR(191) NOT NULL,
    `contentSnapshot` TEXT NOT NULL,
    `output` TEXT NOT NULL,
    `durationMs` INTEGER NOT NULL,

    INDEX `user_script_executions_userId_idx`(`userId`),
    INDEX `user_script_executions_scriptId_idx`(`scriptId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversations` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(200) NULL,
    `relayTokenId` VARCHAR(191) NULL,

    INDEX `conversations_userId_idx`(`userId`),
    INDEX `conversations_relayTokenId_idx`(`relayTokenId`),
    INDEX `conversations_userId_createTime_idx`(`userId`, `createTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_preferences` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `notificationEmail` VARCHAR(200) NULL,
    `subscribedEvents` JSON NOT NULL,
    `thresholds` JSON NOT NULL,
    `cooldownMinutes` INTEGER NOT NULL DEFAULT 60,

    UNIQUE INDEX `notification_preferences_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_webhooks` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `preferenceId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `url` VARCHAR(2048) NOT NULL,
    `format` VARCHAR(30) NOT NULL DEFAULT 'generic',
    `secret` VARCHAR(200) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,

    INDEX `notification_webhooks_userId_idx`(`userId`),
    INDEX `notification_webhooks_preferenceId_idx`(`preferenceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_logs` (
    `id` VARCHAR(191) NOT NULL,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(60) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `content` TEXT NOT NULL,
    `channel` VARCHAR(20) NOT NULL,
    `webhookId` VARCHAR(191) NULL,
    `deliveryStatus` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `errorMessage` VARCHAR(500) NULL,
    `metadata` JSON NULL,

    INDEX `notification_logs_userId_idx`(`userId`),
    INDEX `notification_logs_userId_createTime_idx`(`userId`, `createTime`),
    INDEX `notification_logs_eventType_idx`(`eventType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_inbox_items` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(60) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `content` TEXT NOT NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `readTime` DATETIME(3) NULL,
    `metadata` JSON NULL,

    INDEX `notification_inbox_items_userId_createTime_idx`(`userId`, `createTime`),
    INDEX `notification_inbox_items_userId_isRead_createTime_idx`(`userId`, `isRead`, `createTime`),
    INDEX `notification_inbox_items_eventType_idx`(`eventType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `messages` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(20) NOT NULL,
    `content` TEXT NOT NULL,
    `model` VARCHAR(100) NULL,
    `inputTokens` INTEGER NULL,
    `outputTokens` INTEGER NULL,
    `totalTokens` INTEGER NULL,
    `cost` DECIMAL(10, 4) NULL,

    INDEX `messages_conversationId_idx`(`conversationId`),
    INDEX `messages_createTime_idx`(`createTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `track_events` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `page` VARCHAR(191) NOT NULL,
    `element` VARCHAR(191) NULL,
    `label` VARCHAR(191) NULL,
    `properties` JSON NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `clientTime` BIGINT NOT NULL,
    `serverTime` BIGINT NOT NULL,
    `ua` TEXT NULL,
    `screenW` INTEGER NULL,
    `screenH` INTEGER NULL,
    `language` VARCHAR(191) NULL,
    `ip` VARCHAR(191) NULL,

    INDEX `track_events_sessionId_idx`(`sessionId`),
    INDEX `track_events_userId_idx`(`userId`),
    INDEX `track_events_name_idx`(`name`),
    INDEX `track_events_page_idx`(`page`),
    INDEX `track_events_serverTime_idx`(`serverTime`),
    INDEX `track_events_status_serverTime_idx`(`status`, `serverTime`),
    INDEX `track_events_name_status_serverTime_idx`(`name`, `status`, `serverTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `heatmap_points` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `pointType` VARCHAR(191) NOT NULL,
    `page` VARCHAR(191) NOT NULL,
    `xRatio` DECIMAL(8, 6) NOT NULL,
    `yRatio` DECIMAL(8, 6) NOT NULL,
    `scrollDepth` INTEGER NOT NULL DEFAULT 0,
    `viewportW` INTEGER NULL,
    `viewportH` INTEGER NULL,
    `sessionId` VARCHAR(191) NULL,
    `serverTime` BIGINT NOT NULL,

    INDEX `heatmap_points_page_pointType_idx`(`page`, `pointType`),
    INDEX `heatmap_points_serverTime_idx`(`serverTime`),
    INDEX `heatmap_points_page_pointType_status_serverTime_idx`(`page`, `pointType`, `status`, `serverTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `groups`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_accountOwnerId_fkey` FOREIGN KEY (`accountOwnerId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_parentUserId_fkey` FOREIGN KEY (`parentUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `groups` ADD CONSTRAINT `groups_accountOwnerId_fkey` FOREIGN KEY (`accountOwnerId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ram_roles` ADD CONSTRAINT `ram_roles_accountOwnerId_fkey` FOREIGN KEY (`accountOwnerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ram_user_role_bindings` ADD CONSTRAINT `ram_user_role_bindings_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ram_user_role_bindings` ADD CONSTRAINT `ram_user_role_bindings_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `ram_roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ram_group_role_bindings` ADD CONSTRAINT `ram_group_role_bindings_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ram_group_role_bindings` ADD CONSTRAINT `ram_group_role_bindings_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `ram_roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ram_role_sessions` ADD CONSTRAINT `ram_role_sessions_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `ram_roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ram_role_sessions` ADD CONSTRAINT `ram_role_sessions_subjectUserId_fkey` FOREIGN KEY (`subjectUserId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ram_policies` ADD CONSTRAINT `ram_policies_accountOwnerId_fkey` FOREIGN KEY (`accountOwnerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ram_policy_attachments` ADD CONSTRAINT `ram_policy_attachments_accountOwnerId_fkey` FOREIGN KEY (`accountOwnerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ram_policy_attachments` ADD CONSTRAINT `ram_policy_attachments_policyId_fkey` FOREIGN KEY (`policyId`) REFERENCES `ram_policies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_online_sessions` ADD CONSTRAINT `user_online_sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `passkey_credentials` ADD CONSTRAINT `passkey_credentials_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `two_factor_credentials` ADD CONSTRAINT `two_factor_credentials_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_tokens` ADD CONSTRAINT `relay_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_tokens` ADD CONSTRAINT `relay_tokens_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `relay_channels`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_token_quota_windows` ADD CONSTRAINT `relay_token_quota_windows_relayTokenId_fkey` FOREIGN KEY (`relayTokenId`) REFERENCES `relay_tokens`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_token_failover_configs` ADD CONSTRAINT `relay_token_failover_configs_relayTokenId_fkey` FOREIGN KEY (`relayTokenId`) REFERENCES `relay_tokens`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_token_channel_configs` ADD CONSTRAINT `relay_token_channel_configs_relayTokenId_fkey` FOREIGN KEY (`relayTokenId`) REFERENCES `relay_tokens`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_token_channel_configs` ADD CONSTRAINT `relay_token_channel_configs_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `relay_channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_channel_switch_logs` ADD CONSTRAINT `relay_channel_switch_logs_relayTokenId_fkey` FOREIGN KEY (`relayTokenId`) REFERENCES `relay_tokens`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_channel_switch_logs` ADD CONSTRAINT `relay_channel_switch_logs_fromChannelId_fkey` FOREIGN KEY (`fromChannelId`) REFERENCES `relay_channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_channel_switch_logs` ADD CONSTRAINT `relay_channel_switch_logs_toChannelId_fkey` FOREIGN KEY (`toChannelId`) REFERENCES `relay_channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_usages` ADD CONSTRAINT `relay_usages_relayTokenId_fkey` FOREIGN KEY (`relayTokenId`) REFERENCES `relay_tokens`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `access_keys` ADD CONSTRAINT `access_keys_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `oauth_clients` ADD CONSTRAINT `oauth_clients_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `oauth_clients` ADD CONSTRAINT `oauth_clients_reviewedByUserId_fkey` FOREIGN KEY (`reviewedByUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `oauth_authorization_codes` ADD CONSTRAINT `oauth_authorization_codes_oauthClientId_fkey` FOREIGN KEY (`oauthClientId`) REFERENCES `oauth_clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `oauth_authorization_codes` ADD CONSTRAINT `oauth_authorization_codes_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `oauth_access_tokens` ADD CONSTRAINT `oauth_access_tokens_oauthClientId_fkey` FOREIGN KEY (`oauthClientId`) REFERENCES `oauth_clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `oauth_access_tokens` ADD CONSTRAINT `oauth_access_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `oauth_refresh_tokens` ADD CONSTRAINT `oauth_refresh_tokens_oauthClientId_fkey` FOREIGN KEY (`oauthClientId`) REFERENCES `oauth_clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `oauth_refresh_tokens` ADD CONSTRAINT `oauth_refresh_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `oauth_consents` ADD CONSTRAINT `oauth_consents_oauthClientId_fkey` FOREIGN KEY (`oauthClientId`) REFERENCES `oauth_clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `oauth_consents` ADD CONSTRAINT `oauth_consents_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_center_clients` ADD CONSTRAINT `auth_center_clients_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_center_clients` ADD CONSTRAINT `auth_center_clients_reviewedByUserId_fkey` FOREIGN KEY (`reviewedByUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_center_authorization_codes` ADD CONSTRAINT `auth_center_authorization_codes_authCenterClientId_fkey` FOREIGN KEY (`authCenterClientId`) REFERENCES `auth_center_clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_center_authorization_codes` ADD CONSTRAINT `auth_center_authorization_codes_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_center_access_tokens` ADD CONSTRAINT `auth_center_access_tokens_authCenterClientId_fkey` FOREIGN KEY (`authCenterClientId`) REFERENCES `auth_center_clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_center_access_tokens` ADD CONSTRAINT `auth_center_access_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_center_refresh_tokens` ADD CONSTRAINT `auth_center_refresh_tokens_authCenterClientId_fkey` FOREIGN KEY (`authCenterClientId`) REFERENCES `auth_center_clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_center_refresh_tokens` ADD CONSTRAINT `auth_center_refresh_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_center_consents` ADD CONSTRAINT `auth_center_consents_authCenterClientId_fkey` FOREIGN KEY (`authCenterClientId`) REFERENCES `auth_center_clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_center_consents` ADD CONSTRAINT `auth_center_consents_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `redemption_codes` ADD CONSTRAINT `redemption_codes_usedBy_fkey` FOREIGN KEY (`usedBy`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `redemption_codes` ADD CONSTRAINT `redemption_codes_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `balance_accounts` ADD CONSTRAINT `balance_accounts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remote_terminal_user_entitlements` ADD CONSTRAINT `remote_terminal_user_entitlements_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remote_terminal_user_entitlements` ADD CONSTRAINT `remote_terminal_user_entitlements_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `remote_terminal_product_templates`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remote_terminal_entitlement_tokens` ADD CONSTRAINT `remote_terminal_entitlement_tokens_entitlementId_fkey` FOREIGN KEY (`entitlementId`) REFERENCES `remote_terminal_user_entitlements`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remote_terminal_device_bindings` ADD CONSTRAINT `remote_terminal_device_bindings_entitlementId_fkey` FOREIGN KEY (`entitlementId`) REFERENCES `remote_terminal_user_entitlements`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remote_terminal_device_bindings` ADD CONSTRAINT `remote_terminal_device_bindings_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remote_terminal_device_bindings` ADD CONSTRAINT `remote_terminal_device_bindings_registrationTokenId_fkey` FOREIGN KEY (`registrationTokenId`) REFERENCES `remote_terminal_entitlement_tokens`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `monthly_pass_template_quota_windows` ADD CONSTRAINT `monthly_pass_template_quota_windows_monthlyPassTemplateId_fkey` FOREIGN KEY (`monthlyPassTemplateId`) REFERENCES `monthly_pass_templates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_monthly_passes` ADD CONSTRAINT `user_monthly_passes_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_monthly_passes` ADD CONSTRAINT `user_monthly_passes_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `monthly_pass_templates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_monthly_pass_quota_windows` ADD CONSTRAINT `user_monthly_pass_quota_windows_userMonthlyPassId_fkey` FOREIGN KEY (`userMonthlyPassId`) REFERENCES `user_monthly_passes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `monthly_pass_usages` ADD CONSTRAINT `monthly_pass_usages_userMonthlyPassId_fkey` FOREIGN KEY (`userMonthlyPassId`) REFERENCES `user_monthly_passes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `oj_api_keys` ADD CONSTRAINT `oj_api_keys_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `relay_channels`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `oj_usage_records` ADD CONSTRAINT `oj_usage_records_ojApiKeyId_fkey` FOREIGN KEY (`ojApiKeyId`) REFERENCES `oj_api_keys`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `json_endpoints` ADD CONSTRAINT `json_endpoints_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `articles` ADD CONSTRAINT `articles_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `legal_policy_versions` ADD CONSTRAINT `legal_policy_versions_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `legal_policy_versions` ADD CONSTRAINT `legal_policy_versions_updatedBy_fkey` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_policy_acceptances` ADD CONSTRAINT `user_policy_acceptances_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_policy_acceptances` ADD CONSTRAINT `user_policy_acceptances_policyVersionId_fkey` FOREIGN KEY (`policyVersionId`) REFERENCES `legal_policy_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_assigneeUserId_fkey` FOREIGN KEY (`assigneeUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_comments` ADD CONSTRAINT `ticket_comments_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `tickets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_comments` ADD CONSTRAINT `ticket_comments_authorUserId_fkey` FOREIGN KEY (`authorUserId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_scripts` ADD CONSTRAINT `user_scripts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_script_executions` ADD CONSTRAINT `user_script_executions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_script_executions` ADD CONSTRAINT `user_script_executions_scriptId_fkey` FOREIGN KEY (`scriptId`) REFERENCES `user_scripts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_relayTokenId_fkey` FOREIGN KEY (`relayTokenId`) REFERENCES `relay_tokens`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_preferences` ADD CONSTRAINT `notification_preferences_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_webhooks` ADD CONSTRAINT `notification_webhooks_preferenceId_fkey` FOREIGN KEY (`preferenceId`) REFERENCES `notification_preferences`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_inbox_items` ADD CONSTRAINT `notification_inbox_items_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

