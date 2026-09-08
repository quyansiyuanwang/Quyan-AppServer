import { createCompatibilitySiteModule } from '../create-compatibility-site-module'
import views from '@/router/.gen/domain-views/public.gen'

export default createCompatibilitySiteModule('public', undefined, views)
