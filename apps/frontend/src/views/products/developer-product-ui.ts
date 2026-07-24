import type { DeveloperProductCode } from '@/client/types.gen'
import { Permission } from '@/constant/permission'

export const PRODUCT_COPY: Record<
  DeveloperProductCode,
  { name: string; description: string; actions: string[] }
> = {
  kv: {
    name: 'KV 存储',
    description: '为小型应用保存 JSON 配置、计数器和临时状态。',
    actions: [
      Permission.PRODUCT_KV_READ,
      Permission.PRODUCT_KV_WRITE,
      Permission.PRODUCT_KV_MANAGE,
    ],
  },
  short_link: {
    name: '短链接',
    description: '管理短链、跳转状态与访问统计。',
    actions: [
      Permission.PRODUCT_SHORT_LINK_READ,
      Permission.PRODUCT_SHORT_LINK_WRITE,
      Permission.PRODUCT_SHORT_LINK_MANAGE,
    ],
  },
  secret: {
    name: '密钥托管',
    description: '以别名保存敏感配置，在出站请求中安全替换。',
    actions: [
      Permission.PRODUCT_SECRET_READ,
      Permission.PRODUCT_SECRET_WRITE,
      Permission.PRODUCT_SECRET_USE,
      Permission.PRODUCT_SECRET_MANAGE,
    ],
  },
  status: {
    name: '状态监控',
    description: '检测上游可用性，并发布公开状态页。',
    actions: [
      Permission.PRODUCT_STATUS_READ,
      Permission.PRODUCT_STATUS_WRITE,
      Permission.PRODUCT_STATUS_PUBLISH,
      Permission.PRODUCT_STATUS_MANAGE,
    ],
  },
  verification: {
    name: '验证码',
    description: '为邮箱和已启用的短信渠道提供发送与验证 API。',
    actions: [
      Permission.PRODUCT_VERIFICATION_SEND,
      Permission.PRODUCT_VERIFICATION_VERIFY,
      Permission.PRODUCT_VERIFICATION_MANAGE,
    ],
  },
  ip_geolocation: {
    name: 'IP 定位',
    description: '按日额度查询公网 IP 的标准化地域和 ASN 信息。',
    actions: [Permission.PRODUCT_IP_GEOLOCATION_LOOKUP, Permission.PRODUCT_IP_GEOLOCATION_MANAGE],
  },
  push: {
    name: '推送聚合',
    description: '通过统一 API 投递 Webhook、钉钉、飞书与企业微信消息。',
    actions: [
      Permission.PRODUCT_PUSH_SEND,
      Permission.PRODUCT_PUSH_CHANNEL_MANAGE,
      Permission.PRODUCT_PUSH_DELIVERY_READ,
      Permission.PRODUCT_PUSH_MANAGE,
    ],
  },
}

export const productName = (product: DeveloperProductCode) => PRODUCT_COPY[product].name
export const userRoute = (product: DeveloperProductCode) => `product-${product}`
export const managementRoute = (product: DeveloperProductCode) => `product-management-${product}`
export const configRoute = (product: DeveloperProductCode) => `product-config-${product}`
