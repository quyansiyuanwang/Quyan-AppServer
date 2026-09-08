import { createCompatibilitySiteModule } from '../create-compatibility-site-module'
import views from '@/router/.gen/domain-views/product-secret.gen'

export default createCompatibilitySiteModule('product-secret', 'console-product-secret', views)
