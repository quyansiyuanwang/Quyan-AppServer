import base from './base/zh-CN'
import shared from './sites/shared/zh-CN'
import publicSite from './sites/public/zh-CN'
import identity from './sites/identity/zh-CN'
import account from './sites/account/zh-CN'
import chat from './sites/chat/zh-CN'
import terminal from './sites/terminal/zh-CN'
import console_ai from './sites/console-ai/zh-CN'
import console_developer from './sites/console-developer/zh-CN'
import console_ram from './sites/console-ram/zh-CN'
import product_kv from './sites/product-kv/zh-CN'
import product_short_link from './sites/product-short_link/zh-CN'
import product_secret from './sites/product-secret/zh-CN'
import product_status from './sites/product-status/zh-CN'
import product_verification from './sites/product-verification/zh-CN'
import product_ip_geolocation from './sites/product-ip_geolocation/zh-CN'
import product_push from './sites/product-push/zh-CN'
import product_json_endpoint from './sites/product-json_endpoint/zh-CN'
import product_oj from './sites/product-oj/zh-CN'
import management_ai from './sites/management-ai/zh-CN'
import management_core from './sites/management-core/zh-CN'
import management_developer from './sites/management-developer/zh-CN'
import management_terminal from './sites/management-terminal/zh-CN'

import type en from './en'
import type { DeepStringify } from '@/types/common'

const zhCN: DeepStringify<typeof en> = {
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
}

export default zhCN
