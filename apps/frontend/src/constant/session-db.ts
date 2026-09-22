export const SESSION_DB_PREFIX = 'AppServerSessionDB'
export const getSessionDbName = (scope: string): string => `${SESSION_DB_PREFIX}::${scope}`
