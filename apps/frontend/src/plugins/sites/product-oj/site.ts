import { createCompatibilitySiteModule } from '../create-compatibility-site-module'
import views from '@/router/.gen/domain-views/product-oj.gen'

export default createCompatibilitySiteModule('product-oj', 'console-product-oj', views)
