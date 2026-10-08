// Locale bundle: product-ip_geolocation/emoji.
import type en from './en'
import type { DeepStringify } from '@/types/common'

const emoji = {} as const satisfies DeepStringify<typeof en>

export default emoji
