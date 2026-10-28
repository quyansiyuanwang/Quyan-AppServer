/** Reserved authorization namespace for shared deployment resources, never a user's account ID. */
export const IAM_PLATFORM_ACCOUNT_ID = 'platform'

/** Shared wire filename grammar for server-log routes, filesystem selection and IAM resources. */
export const IAM_SERVER_LOG_FILE_NAME_PATTERN =
  /^(combined|error)-(\d{4}-\d{2}-\d{2})\.log(?:\.gz)?$/
