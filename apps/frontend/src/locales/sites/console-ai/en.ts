// Locale bundle: console-ai/en.
const en = {
  productConfig: {
    titleSuffix: 'Product Configuration',
    description:
      'Set the global availability, included quota, and overage price used by this product.',
    serviceSwitch: 'Service availability',
    serviceSwitchDescription:
      'When disabled, new external calls are rejected immediately while existing data remains unchanged.',
    dailyQuota: 'Default daily free quota',
    overagePrice: 'Overage unit price',
    freeUnlimitedHint: 'An overage price of 0 makes this product free with unlimited daily quota.',
    instanceLimit: 'Default instance limit',
    loadError: 'Product configuration could not be loaded.',
    saved: 'Product configuration saved',
  },
  productOperations: {
    titleSuffix: 'Operations',
    description:
      'Manage a primary account’s quota, overage billing, and instance limit without changing RAM product permissions.',
    searchPlaceholder: 'Search username, display name, or account ID',
    user: 'User',
    userId: 'Account ID',
    quota: 'Daily free quota',
    useDefaultQuota: 'Use product default quota',
    overageEnabled: 'Allow overage billing',
    instanceLimit: 'Instance limit',
    manageUser: 'Manage user',
    accountNotConfigured: 'No operations record',
    accountSettings: 'Operations settings',
    instances: 'Instances',
    usage: 'Usage',
    audit: 'Call audit',
    saveSuccess: 'Operations settings saved',
  },
  productCatalog: {
    title: 'Product catalog',
    description:
      'Each service has independent instances, API keys, RAM permissions, and call quotas.',
    refresh: 'Refresh product catalog',
    api: 'API',
    managedService: 'Management-only service',
    quota: 'Quota',
    perDay: '/ day',
    enter: 'Open product',
    actions: 'Product actions',
    noAccess: 'No access',
    disabled: 'Service disabled',
    available: 'Available',
    loadError: 'Product catalog could not be loaded. Refresh and try again.',
  },
  productFeedback: {
    loadFailed: 'Product data could not be loaded. Try again.',
    operationFailed: 'The product operation failed. Try again.',
    retry: 'Retry',
    formError: 'Resolve the request error before trying again.',
  },
} as const

export default en
