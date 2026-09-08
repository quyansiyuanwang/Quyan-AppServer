import { createCompatibilitySiteModule } from '../create-compatibility-site-module'
import views from '@/router/.gen/domain-views/product-short_link.gen'

export default createCompatibilitySiteModule(
  'product-short_link',
  'console-product-short_link',
  views,
)
