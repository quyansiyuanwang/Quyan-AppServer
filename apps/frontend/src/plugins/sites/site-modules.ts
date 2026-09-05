import type { SiteProfileId } from '@/config/site-registry'
import type { SiteModule } from '@/plugins/modules/contracts'
import account from './account/site'
import chat from './chat/site'
import consoleAi from './console-ai/site'
import consoleDeveloper from './console-developer/site'
import consoleRam from './console-ram/site'
import identity from './identity/site'
import managementAi from './management-ai/site'
import managementCore from './management-core/site'
import managementDeveloper from './management-developer/site'
import managementTerminal from './management-terminal/site'
import productIpGeolocation from './product-ip_geolocation/site'
import productKv from './product-kv/site'
import productOj from './product-oj/site'
import productPush from './product-push/site'
import productSecret from './product-secret/site'
import productShortLink from './product-short_link/site'
import productStatus from './product-status/site'
import productVerification from './product-verification/site'
import productJsonEndpoint from './product-json_endpoint/site'
import publicSite from './public/site'
import terminal from './terminal/site'

export const siteModules = {
  account,
  chat,
  'console-ai': consoleAi,
  'console-developer': consoleDeveloper,
  'console-ram': consoleRam,
  identity,
  'management-ai': managementAi,
  'management-core': managementCore,
  'management-developer': managementDeveloper,
  'management-terminal': managementTerminal,
  'product-ip_geolocation': productIpGeolocation,
  'product-kv': productKv,
  'product-oj': productOj,
  'product-push': productPush,
  'product-secret': productSecret,
  'product-short_link': productShortLink,
  'product-status': productStatus,
  'product-verification': productVerification,
  'product-json_endpoint': productJsonEndpoint,
  public: publicSite,
  terminal,
} satisfies Partial<Record<SiteProfileId, SiteModule>>
