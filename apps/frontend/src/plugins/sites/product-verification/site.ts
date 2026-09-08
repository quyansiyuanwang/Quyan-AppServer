import { createCompatibilitySiteModule } from '../create-compatibility-site-module'
import views from '@/router/.gen/domain-views/product-verification.gen'

export default createCompatibilitySiteModule(
  'product-verification',
  'console-product-verification',
  views,
)
