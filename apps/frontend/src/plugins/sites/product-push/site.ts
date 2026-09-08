import { createCompatibilitySiteModule } from '../create-compatibility-site-module'
import views from '@/router/.gen/domain-views/product-push.gen'

export default createCompatibilitySiteModule('product-push', 'console-product-push', views)
