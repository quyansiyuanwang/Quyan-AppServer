import base from './base/emoji'
import shared from './sites/shared/emoji'
import publicSite from './sites/public/emoji'
import identity from './sites/identity/emoji'
import account from './sites/account/emoji'
import chat from './sites/chat/emoji'
import terminal from './sites/terminal/emoji'
import console_ai from './sites/console-ai/emoji'
import console_developer from './sites/console-developer/emoji'
import console_ram from './sites/console-ram/emoji'
import product_kv from './sites/product-kv/emoji'
import product_short_link from './sites/product-short_link/emoji'
import product_secret from './sites/product-secret/emoji'
import product_status from './sites/product-status/emoji'
import product_verification from './sites/product-verification/emoji'
import product_ip_geolocation from './sites/product-ip_geolocation/emoji'
import product_push from './sites/product-push/emoji'
import product_json_endpoint from './sites/product-json_endpoint/emoji'
import product_oj from './sites/product-oj/emoji'
import management_ai from './sites/management-ai/emoji'
import management_core from './sites/management-core/emoji'
import management_developer from './sites/management-developer/emoji'
import management_terminal from './sites/management-terminal/emoji'

import type en from './en'
import type { DeepStringify } from '@/types/common'

const emoji = {
  ...base,
  ...shared,
  ...publicSite,
  ...identity,
  ...account,
  ...chat,
  ...terminal,
  ...console_ai,
  ...console_developer,
  ...console_ram,
  ...product_kv,
  ...product_short_link,
  ...product_secret,
  ...product_status,
  ...product_verification,
  ...product_ip_geolocation,
  ...product_push,
  ...product_json_endpoint,
  ...product_oj,
  ...management_ai,
  ...management_core,
  ...management_developer,
  ...management_terminal,
} as const satisfies DeepStringify<typeof en>

export default emoji
