import { createCompatibilitySiteModule } from '../create-compatibility-site-module'
import views from '@/router/.gen/domain-views/product-status.gen'

export default createCompatibilitySiteModule('product-status', 'console-product-status', views)
