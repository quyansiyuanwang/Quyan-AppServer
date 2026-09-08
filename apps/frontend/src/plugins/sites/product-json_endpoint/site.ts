import { createCompatibilitySiteModule } from '../create-compatibility-site-module'
import views from '@/router/.gen/domain-views/product-json_endpoint.gen'

export default createCompatibilitySiteModule(
  'product-json_endpoint',
  'console-product-json_endpoint',
  views,
)
