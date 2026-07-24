import type { DeveloperProductCode } from '@/client/types.gen'
import { Permission } from '@/constant/permission'
import { i18ns } from '@/locales'

export const PRODUCT_COPY: Record<DeveloperProductCode, { nameKey: string; descriptionKey: string; actions: string[] }> = {
  kv: { nameKey: 'nav.productKv', descriptionKey: 'developerProducts.kvDescription', actions: [Permission.PRODUCT_KV_READ, Permission.PRODUCT_KV_WRITE, Permission.PRODUCT_KV_MANAGE] },
  short_link: { nameKey: 'nav.productShortLink', descriptionKey: 'developerProducts.shortLinkDescription', actions: [Permission.PRODUCT_SHORT_LINK_READ, Permission.PRODUCT_SHORT_LINK_WRITE, Permission.PRODUCT_SHORT_LINK_MANAGE] },
  secret: { nameKey: 'nav.productSecret', descriptionKey: 'developerProducts.secretDescription', actions: [Permission.PRODUCT_SECRET_READ, Permission.PRODUCT_SECRET_WRITE, Permission.PRODUCT_SECRET_USE, Permission.PRODUCT_SECRET_MANAGE] },
  status: { nameKey: 'nav.productStatus', descriptionKey: 'developerProducts.statusDescription', actions: [Permission.PRODUCT_STATUS_READ, Permission.PRODUCT_STATUS_WRITE, Permission.PRODUCT_STATUS_PUBLISH, Permission.PRODUCT_STATUS_MANAGE] },
  verification: { nameKey: 'nav.productVerification', descriptionKey: 'developerProducts.verificationDescription', actions: [Permission.PRODUCT_VERIFICATION_SEND, Permission.PRODUCT_VERIFICATION_VERIFY, Permission.PRODUCT_VERIFICATION_MANAGE] },
  ip_geolocation: { nameKey: 'nav.productIpGeolocation', descriptionKey: 'developerProducts.ipGeolocationDescription', actions: [Permission.PRODUCT_IP_GEOLOCATION_LOOKUP, Permission.PRODUCT_IP_GEOLOCATION_MANAGE] },
  push: { nameKey: 'nav.productPush', descriptionKey: 'developerProducts.pushDescription', actions: [Permission.PRODUCT_PUSH_SEND, Permission.PRODUCT_PUSH_CHANNEL_MANAGE, Permission.PRODUCT_PUSH_DELIVERY_READ, Permission.PRODUCT_PUSH_MANAGE] },
}

export const productCopy = (product: DeveloperProductCode) => ({
  ...PRODUCT_COPY[product],
  name: i18ns.t(PRODUCT_COPY[product].nameKey as any),
  description: i18ns.t(PRODUCT_COPY[product].descriptionKey as any),
})

export const productName = (product: DeveloperProductCode) => productCopy(product).name
export const userRoute = (product: DeveloperProductCode) => `product-${product}`
export const managementRoute = (product: DeveloperProductCode) => `product-management-${product}`
export const configRoute = (product: DeveloperProductCode) => `product-config-${product}`
