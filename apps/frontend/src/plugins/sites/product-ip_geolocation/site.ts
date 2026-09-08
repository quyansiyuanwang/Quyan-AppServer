import { createCompatibilitySiteModule } from '../create-compatibility-site-module'
import views from '@/router/.gen/domain-views/product-ip_geolocation.gen'

export default createCompatibilitySiteModule(
  'product-ip_geolocation',
  'console-product-ip_geolocation',
  views,
)
