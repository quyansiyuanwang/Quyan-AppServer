import { createCompatibilitySiteModule } from '../create-compatibility-site-module'
import views from '@/router/.gen/domain-views/product-kv.gen'

export default createCompatibilitySiteModule('product-kv', 'console-product-kv', views)
